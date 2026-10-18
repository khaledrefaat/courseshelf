//! Course-scoped loopback media, with a new secret and root registry each launch.
use percent_encoding::{NON_ALPHANUMERIC, percent_decode_str, utf8_percent_encode};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{self, Read, Seek, SeekFrom},
    net::{Ipv4Addr, SocketAddr},
    path::{Path, PathBuf},
    sync::{
        Arc, RwLock,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};
use subtle::ConstantTimeEq;
use tauri_plugin_fs::FsExt;
use tiny_http::{Header, Method, Request, Response, ResponseBox, Server, StatusCode};

#[derive(Debug, Serialize)]
pub struct MediaError {
    code: &'static str,
    message: &'static str,
}

fn failure(code: &'static str, message: &'static str) -> MediaError {
    MediaError { code, message }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseRoot {
    course_id: i64,
    root_path: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RegistrationStatus {
    Registered,
    Unauthorized,
    Missing,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Registration {
    course_id: i64,
    status: RegistrationStatus,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSession {
    base_url: String,
    session_token: String,
}

struct Shared {
    token: String,
    roots: RwLock<HashMap<i64, PathBuf>>,
    stopped: AtomicBool,
}

pub struct VideoStream {
    address: SocketAddr,
    shared: Arc<Shared>,
}

impl VideoStream {
    pub fn new() -> io::Result<Self> {
        let mut secret = [0_u8; 32];
        getrandom::fill(&mut secret)
            .map_err(|_| io::Error::other("Could not obtain secure playback randomness"))?;
        let token = secret.iter().map(|byte| format!("{byte:02x}")).collect();
        let server = Arc::new(
            Server::http((Ipv4Addr::LOCALHOST, 0))
                .map_err(|_| io::Error::other("Could not bind playback server"))?,
        );
        let address = server
            .server_addr()
            .to_ip()
            .ok_or_else(|| io::Error::other("Playback server requires a TCP address"))?;
        let shared = Arc::new(Shared {
            token,
            roots: RwLock::new(HashMap::new()),
            stopped: AtomicBool::new(false),
        });
        for _ in 0..4 {
            let server = server.clone();
            let shared = shared.clone();
            thread::Builder::new()
                .name("course-media".into())
                .spawn(move || {
                    while !shared.stopped.load(Ordering::Relaxed) {
                        match server.recv_timeout(Duration::from_millis(200)) {
                            Ok(Some(request)) => {
                                let response = response_for(&request, address, &shared);
                                // Seeking normally aborts the previous response. Never log its URL or IO error.
                                let _ = request.respond(response);
                            }
                            Ok(None) => {}
                            Err(_) => break,
                        }
                    }
                })?;
        }
        Ok(Self { address, shared })
    }

    pub fn register_all(
        &self,
        roots: Vec<CourseRoot>,
        allowed: &impl Fn(&Path) -> bool,
    ) -> Result<Vec<Registration>, MediaError> {
        let mut registered = HashMap::new();
        let mut results = Vec::with_capacity(roots.len());
        for input in roots {
            let (result, root) = assess_root(&input, allowed);
            if let Some(root) = root {
                registered.insert(input.course_id, root);
            } else {
                registered.remove(&input.course_id);
            }
            results.push(result);
        }
        *self
            .shared
            .roots
            .write()
            .map_err(|_| failure("SERVER_ERROR", "Root registry unavailable"))? = registered;
        Ok(results)
    }

    pub fn register(
        &self,
        input: CourseRoot,
        allowed: &impl Fn(&Path) -> bool,
    ) -> Result<Registration, MediaError> {
        let (result, root) = assess_root(&input, allowed);
        let mut roots = self
            .shared
            .roots
            .write()
            .map_err(|_| failure("SERVER_ERROR", "Root registry unavailable"))?;
        // A failed re-registration must revoke the old root rather than keep serving it.
        roots.remove(&input.course_id);
        if let Some(root) = root {
            roots.insert(input.course_id, root);
        }
        Ok(result)
    }

    pub fn unregister(&self, course_id: i64) -> Result<(), MediaError> {
        self.shared
            .roots
            .write()
            .map_err(|_| failure("SERVER_ERROR", "Root registry unavailable"))?
            .remove(&course_id);
        Ok(())
    }

    pub fn registered_paths(&self) -> Result<Vec<PathBuf>, MediaError> {
        Ok(self
            .shared
            .roots
            .read()
            .map_err(|_| failure("SERVER_ERROR", "Root registry unavailable"))?
            .values()
            .cloned()
            .collect())
    }

    pub fn lesson_url(&self, course_id: i64, relative_path: &str) -> Result<String, MediaError> {
        resolve_lesson(&self.shared, course_id, relative_path)?;
        let encoded = relative_path
            .split('/')
            .map(|segment| utf8_percent_encode(segment, NON_ALPHANUMERIC).to_string())
            .collect::<Vec<_>>()
            .join("/");
        Ok(format!(
            "http://{}/media/{}/{course_id}/{encoded}",
            self.address, self.shared.token
        ))
    }

    fn session(&self) -> MediaSession {
        MediaSession {
            base_url: format!("http://{}", self.address),
            session_token: self.shared.token.clone(),
        }
    }
}

impl Drop for VideoStream {
    fn drop(&mut self) {
        self.shared.stopped.store(true, Ordering::Relaxed);
    }
}

fn assess_root(
    input: &CourseRoot,
    allowed: &impl Fn(&Path) -> bool,
) -> (Registration, Option<PathBuf>) {
    let rejected = |status, message: &str| {
        (
            Registration {
                course_id: input.course_id,
                status,
                message: message.into(),
            },
            None,
        )
    };
    let path = Path::new(&input.root_path);
    if input.course_id <= 0 || !path.is_absolute() || !allowed(path) {
        return rejected(
            RegistrationStatus::Unauthorized,
            "Folder not authorized; re-pick the course folder.",
        );
    }
    let canonical = match fs::canonicalize(path) {
        Ok(path) => path,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return rejected(
                RegistrationStatus::Missing,
                "Course folder is missing or its drive is not mounted.",
            );
        }
        Err(_) => {
            return rejected(
                RegistrationStatus::Unauthorized,
                "Course folder is not readable.",
            );
        }
    };
    if !allowed(&canonical) {
        return rejected(
            RegistrationStatus::Unauthorized,
            "Folder not authorized; re-pick the course folder.",
        );
    }
    if !canonical.is_dir() {
        return rejected(
            RegistrationStatus::Missing,
            "Course root is not a directory.",
        );
    }
    if fs::read_dir(&canonical).is_err() {
        return rejected(
            RegistrationStatus::Unauthorized,
            "Course folder is not readable.",
        );
    }
    (
        Registration {
            course_id: input.course_id,
            status: RegistrationStatus::Registered,
            message: "Course folder registered.".into(),
        },
        Some(canonical),
    )
}

struct OpenedLesson {
    file: File,
    length: u64,
    mime: &'static str,
}

fn content_type(relative: &str) -> Result<&'static str, MediaError> {
    match Path::new(relative)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("mp4" | "m4v") => Ok("video/mp4"),
        Some("webm") => Ok("video/webm"),
        _ => Err(failure(
            "INVALID_PATH",
            "Only mp4, m4v and webm lessons are allowed",
        )),
    }
}

fn check_components(root: &Path, relative: &str) -> Result<(), MediaError> {
    let mut path = root.to_path_buf();
    for component in std::iter::once("").chain(relative.split('/')) {
        path.push(component);
        let metadata = fs::symlink_metadata(&path).map_err(|_| {
            failure(
                "LESSON_MISSING",
                "Lesson or course folder is missing or unreadable",
            )
        })?;
        if crate::fs_links::is_link(&metadata) {
            return Err(failure("INVALID_PATH", "Symlinks are not allowed"));
        }
    }
    Ok(())
}

fn resolve_lesson(
    shared: &Shared,
    course_id: i64,
    relative: &str,
) -> Result<OpenedLesson, MediaError> {
    if relative.is_empty()
        || relative.contains(['\\', '\0', ':'])
        || relative
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        || Path::new(relative).is_absolute()
    {
        return Err(failure(
            "INVALID_PATH",
            "An ordinary relative lesson path is required",
        ));
    }
    let mime = content_type(relative)?;
    let root = shared
        .roots
        .read()
        .map_err(|_| failure("SERVER_ERROR", "Root registry unavailable"))?
        .get(&course_id)
        .cloned()
        .ok_or_else(|| failure("COURSE_NOT_REGISTERED", "Course folder is not registered"))?;
    check_components(&root, relative)?;
    if fs::canonicalize(&root).map_err(|_| failure("LESSON_MISSING", "Course folder is missing"))?
        != root
    {
        return Err(failure(
            "INVALID_PATH",
            "Course root changed; register it again",
        ));
    }
    let path = root.join(relative);
    let canonical = fs::canonicalize(&path)
        .map_err(|_| failure("LESSON_MISSING", "Lesson is missing or unreadable"))?;
    if !canonical.starts_with(&root) {
        return Err(failure(
            "INVALID_PATH",
            "Lesson resolved outside its course folder",
        ));
    }
    let file = File::open(&canonical)
        .map_err(|_| failure("LESSON_MISSING", "Lesson is missing or unreadable"))?;
    let metadata = file
        .metadata()
        .map_err(|_| failure("LESSON_MISSING", "Lesson metadata unavailable"))?;
    if !metadata.is_file() {
        return Err(failure("INVALID_PATH", "Lesson must be a regular file"));
    }
    // Recheck after opening, including inode identity, to detect path substitutions.
    check_components(&root, relative)?;
    if fs::canonicalize(&path).map_err(|_| failure("LESSON_MISSING", "Lesson disappeared"))?
        != canonical
    {
        return Err(failure("INVALID_PATH", "Lesson path changed while opening"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let current = fs::symlink_metadata(&canonical)
            .map_err(|_| failure("LESSON_MISSING", "Lesson disappeared"))?;
        if metadata.dev() != current.dev() || metadata.ino() != current.ino() {
            return Err(failure("INVALID_PATH", "Lesson changed while opening"));
        }
    }
    Ok(OpenedLesson {
        file,
        length: metadata.len(),
        mime,
    })
}

fn decode_path(encoded: &str) -> Result<String, MediaError> {
    let bytes = encoded.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len()
                || !bytes[index + 1].is_ascii_hexdigit()
                || !bytes[index + 2].is_ascii_hexdigit()
            {
                return Err(failure("INVALID_PATH", "Invalid URL encoding"));
            }
            index += 3;
        } else {
            index += 1;
        }
    }
    percent_decode_str(encoded)
        .decode_utf8()
        .map(|path| path.into_owned())
        .map_err(|_| failure("INVALID_PATH", "Invalid UTF-8 path"))
}

fn resolve_route(shared: &Shared, route: &str) -> Result<OpenedLesson, MediaError> {
    if route.contains(['?', '#']) {
        return Err(failure(
            "INVALID_PATH",
            "Query strings and fragments are not media paths",
        ));
    }
    let mut parts = route
        .strip_prefix("/media/")
        .ok_or_else(|| failure("INVALID_PATH", "Invalid media route"))?
        .splitn(3, '/');
    let token = parts.next().unwrap_or_default();
    // Token length is public and fixed; equal-length bytes are compared in constant time.
    if !bool::from(token.as_bytes().ct_eq(shared.token.as_bytes())) {
        return Err(failure("BAD_TOKEN", "Invalid media session"));
    }
    let course_id = parts
        .next()
        .and_then(|part| part.parse::<i64>().ok())
        .filter(|id| *id > 0)
        .ok_or_else(|| failure("INVALID_PATH", "Invalid course ID"))?;
    let relative = decode_path(parts.next().unwrap_or_default())?;
    resolve_lesson(shared, course_id, &relative)
}

fn byte_range(value: &str, length: u64) -> Option<(u64, u64)> {
    if length == 0 {
        return None;
    }
    let (start, end) = value.strip_prefix("bytes=")?.split_once('-')?;
    let number = |value: &str| -> Option<u64> {
        if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        value.parse().ok()
    };
    if start.is_empty() {
        let suffix = number(end)?;
        return (suffix > 0).then_some((length.saturating_sub(suffix), length - 1));
    }
    let start = number(start)?;
    let end = if end.is_empty() {
        length - 1
    } else {
        number(end)?.min(length - 1)
    };
    (start < length && start <= end).then_some((start, end))
}

fn header(name: &str, value: &str) -> Header {
    // Callers only use constant header names and controlled ASCII values.
    Header::from_bytes(name, value).expect("valid media response header")
}

fn common(response: ResponseBox) -> ResponseBox {
    response
        .with_header(header("Accept-Ranges", "bytes"))
        .with_header(header("Cache-Control", "no-store"))
        .with_header(header("X-Content-Type-Options", "nosniff"))
        .with_header(header("Referrer-Policy", "no-referrer"))
}

fn empty(status: u16) -> ResponseBox {
    common(Response::empty(StatusCode(status)).boxed())
}

fn response_for(request: &Request, address: SocketAddr, shared: &Shared) -> ResponseBox {
    let hosts: Vec<_> = request
        .headers()
        .iter()
        .filter(|header| header.field.equiv("Host"))
        .collect();
    if hosts.len() != 1 || hosts[0].value.as_str() != address.to_string() {
        return empty(403);
    }
    if request.method() != &Method::Get && request.method() != &Method::Head {
        return empty(405).with_header(header("Allow", "GET, HEAD"));
    }
    let mut lesson = match resolve_route(shared, request.url()) {
        Ok(lesson) => lesson,
        Err(error) => {
            return empty(match error.code {
                "BAD_TOKEN" | "INVALID_PATH" => 403,
                "SERVER_ERROR" => 500,
                _ => 404,
            });
        }
    };
    let ranges: Vec<_> = request
        .headers()
        .iter()
        .filter(|header| header.field.equiv("Range"))
        .collect();
    let range = if request.method() == &Method::Head || ranges.is_empty() {
        None
    } else {
        let parsed = if ranges.len() == 1 {
            byte_range(ranges[0].value.as_str(), lesson.length)
        } else {
            None
        };
        match parsed {
            Some(range) => Some(range),
            None => {
                return empty(416).with_header(header(
                    "Content-Range",
                    &format!("bytes */{}", lesson.length),
                ));
            }
        }
    };
    let (start, length) = range
        .map(|(start, end)| (start, end - start + 1))
        .unwrap_or((0, lesson.length));
    if lesson.file.seek(SeekFrom::Start(start)).is_err() {
        return empty(500);
    }
    let Ok(data_length) = usize::try_from(length) else {
        return empty(500);
    };
    let mut response = Response::new(
        StatusCode(if range.is_some() { 206 } else { 200 }),
        vec![header("Content-Type", lesson.mime)],
        lesson.file.take(length),
        Some(data_length),
        None,
    )
    .with_chunked_threshold(usize::MAX)
    .boxed();
    if let Some((start, end)) = range {
        response = response.with_header(header(
            "Content-Range",
            &format!("bytes {start}-{end}/{}", lesson.length),
        ));
    }
    common(response)
}

#[tauri::command]
pub fn register_course_roots(
    app: tauri::AppHandle,
    state: tauri::State<'_, VideoStream>,
    roots: Vec<CourseRoot>,
) -> Result<Vec<Registration>, MediaError> {
    let scope = app.fs_scope();
    state.register_all(roots, &|path| scope.is_allowed(path))
}

#[tauri::command]
pub fn unregister_course_root(
    state: tauri::State<'_, VideoStream>,
    course_id: i64,
) -> Result<(), MediaError> {
    state.unregister(course_id)
}

#[tauri::command]
pub fn register_course_root(
    app: tauri::AppHandle,
    state: tauri::State<'_, VideoStream>,
    course_id: i64,
    root_path: String,
) -> Result<Registration, MediaError> {
    let scope = app.fs_scope();
    state.register(
        CourseRoot {
            course_id,
            root_path,
        },
        &|path| scope.is_allowed(path),
    )
}

#[tauri::command]
pub fn get_media_session(state: tauri::State<'_, VideoStream>) -> MediaSession {
    state.session()
}

#[tauri::command]
pub fn get_lesson_url(
    state: tauri::State<'_, VideoStream>,
    course_id: i64,
    relative_path: String,
) -> Result<String, MediaError> {
    state.lesson_url(course_id, &relative_path)
}

#[cfg(test)]
mod tests;
