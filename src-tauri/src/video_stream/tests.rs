use super::*;
use std::{io::Write, net::TcpStream, sync::atomic::AtomicUsize};
use tiny_http::TestRequest;

static NEXT_ID: AtomicUsize = AtomicUsize::new(0);

#[test]
fn unregister_is_idempotent_revokes_old_urls_and_keeps_other_courses() {
    let fixture = Fixture::new();
    fixture.file("lesson.mp4");
    fixture
        .media
        .register(
            CourseRoot {
                course_id: 2,
                root_path: fixture.root.to_str().unwrap().into(),
            },
            &|_| true,
        )
        .unwrap();
    let url = fixture.route("lesson.mp4");
    fixture.media.unregister(1).unwrap();
    fixture.media.unregister(1).unwrap();
    assert_eq!(
        error_code(fixture.media.lesson_url(1, "lesson.mp4")),
        "COURSE_NOT_REGISTERED"
    );
    assert!(fixture.media.lesson_url(2, "lesson.mp4").is_ok());
    let request: Request = TestRequest::new()
        .with_path(&url)
        .with_header(header("Host", &fixture.media.address.to_string()))
        .into();
    let response = response_for(&request, fixture.media.address, &fixture.media.shared);
    assert_eq!(response.status_code().0, 404);
}

struct Fixture {
    root: PathBuf,
    media: VideoStream,
}

impl Fixture {
    fn new() -> Self {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join(format!(
            "target/media-tests/{}-{}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        let root = fs::canonicalize(root).unwrap();
        let media = VideoStream {
            address: "127.0.0.1:31415".parse().unwrap(),
            shared: Arc::new(Shared {
                token: "a".repeat(64),
                roots: RwLock::new(HashMap::new()),
                stopped: AtomicBool::new(false),
            }),
        };
        media
            .register(
                CourseRoot {
                    course_id: 1,
                    root_path: root.to_str().unwrap().into(),
                },
                &|_| true,
            )
            .unwrap();
        Self { root, media }
    }

    fn file(&self, relative: &str) {
        let path = self.root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"0123456789").unwrap();
    }

    fn route(&self, relative: &str) -> String {
        let url = self.media.lesson_url(1, relative).unwrap();
        url.strip_prefix(&format!("http://{}", self.media.address))
            .unwrap()
            .into()
    }

    fn request(&self, relative: &str, method: Method, range: Option<&str>) -> Request {
        let mut request = TestRequest::new()
            .with_path(&self.route(relative))
            .with_method(method)
            .with_header(header("Host", &self.media.address.to_string()));
        if let Some(range) = range {
            request = request.with_header(header("Range", range));
        }
        request.into()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.root).unwrap();
    }
}

fn error_code<T>(result: Result<T, MediaError>) -> &'static str {
    match result {
        Err(error) => error.code,
        Ok(_) => panic!("Expected media request rejection"),
    }
}

fn value<'a>(response: &'a ResponseBox, name: &str) -> Option<&'a str> {
    response
        .headers()
        .iter()
        .find(|header| header.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|header| header.value.as_str())
}

#[test]
fn production_webview_origin_keeps_host_validation_and_no_cors_headers() {
    let fixture = Fixture::new();
    fixture.file("lesson.mp4");
    for host in [fixture.media.address.to_string(), "tauri.localhost".into()] {
        let request: Request = TestRequest::new()
            .with_path(&fixture.route("lesson.mp4"))
            .with_header(header("Host", &host))
            .with_header(header("Origin", "tauri://localhost"))
            .into();
        let response = response_for(&request, fixture.media.address, &fixture.media.shared);
        assert_eq!(
            response.status_code().0,
            if host == fixture.media.address.to_string() {
                200
            } else {
                403
            }
        );
        assert!(response.headers().iter().all(|header| {
            !header
                .field
                .as_str()
                .as_str()
                .to_ascii_lowercase()
                .starts_with("access-control-")
        }));
    }
}

#[test]
fn registration_reports_every_root_and_failed_registration_revokes_previous_access() {
    let fixture = Fixture::new();
    let other = Fixture::new();
    let results = fixture
        .media
        .register_all(
            vec![
                CourseRoot {
                    course_id: 1,
                    root_path: fixture.root.to_str().unwrap().into(),
                },
                CourseRoot {
                    course_id: 2,
                    root_path: fixture.root.join("missing").to_str().unwrap().into(),
                },
                CourseRoot {
                    course_id: 3,
                    root_path: other.root.to_str().unwrap().into(),
                },
            ],
            &|path| path.starts_with(&fixture.root),
        )
        .unwrap();
    assert_eq!(results.len(), 3);
    assert_eq!(results[0].status, RegistrationStatus::Registered);
    assert_eq!(results[1].status, RegistrationStatus::Missing);
    assert_eq!(results[2].status, RegistrationStatus::Unauthorized);
    fixture.file("video.mp4");
    assert!(fixture.media.lesson_url(1, "video.mp4").is_ok());
    let result = fixture
        .media
        .register(
            CourseRoot {
                course_id: 1,
                root_path: fixture.root.to_str().unwrap().into(),
            },
            &|_| false,
        )
        .unwrap();
    assert_eq!(result.status, RegistrationStatus::Unauthorized);
    assert_eq!(
        error_code(fixture.media.lesson_url(1, "video.mp4")),
        "COURSE_NOT_REGISTERED"
    );
    fixture.media.register_all(Vec::new(), &|_| true).unwrap();
    assert!(fixture.media.shared.roots.read().unwrap().is_empty());
}

#[test]
fn arabic_spaces_and_reserved_characters_round_trip_without_double_decoding() {
    let fixture = Fixture::new();
    for relative in [
        "القسم الأول/01 - تحليل # ? % +.mp4",
        "space folder/name with spaces.m4v",
        "خاص/%2e%2e + # ?.WEBM",
    ] {
        fixture.file(relative);
        let route = fixture.route(relative);
        assert!(route.is_ascii());
        assert!(!route.contains([' ', '#', '?']));
        let mut opened = resolve_route(&fixture.media.shared, &route).unwrap();
        let mut data = Vec::new();
        opened.file.read_to_end(&mut data).unwrap();
        assert_eq!(data, b"0123456789");
    }
    let route = fixture.route("القسم الأول/01 - تحليل # ? % +.mp4");
    for encoding in ["%23", "%3F", "%25", "%2B", "%20"] {
        assert!(route.contains(encoding));
    }
    assert_eq!(decode_path("a+b.mp4").unwrap(), "a+b.mp4");
    for encoded in ["%", "%GG.mp4", "%0", "%FF.mp4"] {
        assert!(decode_path(encoded).is_err());
    }
}

#[test]
fn rejects_traversal_absolute_paths_wrong_extensions_and_unregistered_courses() {
    let fixture = Fixture::new();
    fixture.file("video.mp4");
    for relative in [
        "../outside.mp4",
        "sub/../../outside.mp4",
        "/video.mp4",
        "C:/video.mp4",
        "C:\\video.mp4",
        "sub\\video.mp4",
        "./video.mp4",
        "sub//video.mp4",
        "video.txt",
        "video.mp4.exe",
        "",
        "bad\0.mp4",
    ] {
        assert_eq!(
            error_code(resolve_lesson(&fixture.media.shared, 1, relative)),
            "INVALID_PATH"
        );
    }
    assert_eq!(
        error_code(resolve_lesson(&fixture.media.shared, 999, "video.mp4")),
        "COURSE_NOT_REGISTERED"
    );
    assert_eq!(
        error_code(resolve_lesson(&fixture.media.shared, 1, "missing.mp4")),
        "LESSON_MISSING"
    );
    for tail in [
        "%2e%2e/outside.mp4",
        "%2Fetc%2Fvideo.mp4",
        "sub%2F..%2F..%2Foutside.mp4",
    ] {
        let route = format!("/media/{}/1/{tail}", fixture.media.shared.token);
        assert_eq!(
            error_code(resolve_route(&fixture.media.shared, &route)),
            "INVALID_PATH"
        );
    }
}

#[test]
fn rejects_bad_session_tokens_of_equal_shorter_and_longer_lengths() {
    let fixture = Fixture::new();
    fixture.file("video.mp4");
    for token in [
        "b".repeat(64),
        "a".repeat(63),
        "a".repeat(65),
        String::new(),
    ] {
        let route = format!("/media/{token}/1/video.mp4");
        assert_eq!(
            error_code(resolve_route(&fixture.media.shared, &route)),
            "BAD_TOKEN"
        );
    }
}

#[cfg(unix)]
#[test]
fn rejects_internal_symlinks_external_symlinks_and_symlinked_directories() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    let outside = Fixture::new();
    fixture.file("real.mp4");
    outside.file("outside.mp4");
    symlink(
        fixture.root.join("real.mp4"),
        fixture.root.join("internal.mp4"),
    )
    .unwrap();
    symlink(
        outside.root.join("outside.mp4"),
        fixture.root.join("escape.mp4"),
    )
    .unwrap();
    symlink(&outside.root, fixture.root.join("escape-dir")).unwrap();
    for path in ["internal.mp4", "escape.mp4", "escape-dir/outside.mp4"] {
        assert_eq!(
            error_code(resolve_lesson(&fixture.media.shared, 1, path)),
            "INVALID_PATH"
        );
    }
}

#[test]
fn parses_bounded_open_ended_and_suffix_ranges_without_empty_file_underflow() {
    assert_eq!(byte_range("bytes=2-5", 10), Some((2, 5)));
    assert_eq!(byte_range("bytes=7-", 10), Some((7, 9)));
    assert_eq!(byte_range("bytes=-3", 10), Some((7, 9)));
    assert_eq!(byte_range("bytes=-20", 10), Some((0, 9)));
    assert_eq!(byte_range("bytes=2-50", 10), Some((2, 9)));
    assert_eq!(byte_range("bytes=0-0", 0), None);
    for invalid in [
        "bytes=10-",
        "bytes=5-2",
        "bytes=-0",
        "bytes=0-1,4-5",
        "bytes=+1-2",
        "bytes=0-18446744073709551616",
        "invalid",
    ] {
        assert_eq!(byte_range(invalid, 10), None);
    }
}

#[test]
fn builds_correct_content_types_lengths_ranges_and_no_cors_headers() {
    let fixture = Fixture::new();
    for (file, mime) in [
        ("video.mp4", "video/mp4"),
        ("video.M4V", "video/mp4"),
        ("video.webm", "video/webm"),
    ] {
        fixture.file(file);
        let request = fixture.request(file, Method::Get, None);
        let response = response_for(&request, fixture.media.address, &fixture.media.shared);
        assert_eq!(response.status_code().0, 200);
        assert_eq!(response.data_length(), Some(10));
        assert_eq!(value(&response, "Content-Type"), Some(mime));
        assert_eq!(value(&response, "Accept-Ranges"), Some("bytes"));
        assert_eq!(value(&response, "Access-Control-Allow-Origin"), None);
    }
    for (range, bytes, content_range) in [
        ("bytes=2-5", "2345", "bytes 2-5/10"),
        ("bytes=7-", "789", "bytes 7-9/10"),
        ("bytes=-3", "789", "bytes 7-9/10"),
    ] {
        let request = fixture.request("video.mp4", Method::Get, Some(range));
        let response = response_for(&request, fixture.media.address, &fixture.media.shared);
        assert_eq!(response.status_code().0, 206);
        assert_eq!(response.data_length(), Some(bytes.len()));
        assert_eq!(value(&response, "Content-Range"), Some(content_range));
        let mut body = String::new();
        response.into_reader().read_to_string(&mut body).unwrap();
        assert_eq!(body, bytes);
    }
    let request = fixture.request("video.mp4", Method::Get, Some("bytes=10-"));
    let response = response_for(&request, fixture.media.address, &fixture.media.shared);
    assert_eq!(response.status_code().0, 416);
    assert_eq!(value(&response, "Content-Range"), Some("bytes */10"));
    assert_eq!(response.data_length(), Some(0));
    let request = fixture.request("video.mp4", Method::Head, Some("bytes=2-5"));
    let response = response_for(&request, fixture.media.address, &fixture.media.shared);
    assert_eq!(response.status_code().0, 200);
    assert_eq!(response.data_length(), Some(10));
}

#[test]
fn rejects_missing_unexpected_and_duplicate_hosts() {
    let fixture = Fixture::new();
    fixture.file("video.mp4");
    for host in [None, Some("evil.example"), Some("127.0.0.1:1")] {
        let mut request = TestRequest::new().with_path(&fixture.route("video.mp4"));
        if let Some(host) = host {
            request = request.with_header(header("Host", host));
        }
        let response = response_for(
            &request.into(),
            fixture.media.address,
            &fixture.media.shared,
        );
        assert_eq!(response.status_code().0, 403);
    }
    let request: Request = TestRequest::new()
        .with_path(&fixture.route("video.mp4"))
        .with_header(header("Host", &fixture.media.address.to_string()))
        .with_header(header("Host", &fixture.media.address.to_string()))
        .into();
    assert_eq!(
        response_for(&request, fixture.media.address, &fixture.media.shared)
            .status_code()
            .0,
        403
    );
}

fn network_request(media: &VideoStream, route: &str, method: &str, range: &str) -> Vec<u8> {
    let mut socket = TcpStream::connect(media.address).unwrap();
    socket
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    write!(
        socket,
        "{method} {route} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n{range}\r\n",
        media.address
    )
    .unwrap();
    let mut response = Vec::new();
    socket.read_to_end(&mut response).unwrap();
    response
}

#[test]
fn loopback_server_survives_aborted_streams_supports_head_and_rotates_session() {
    let fixture = Fixture::new();
    fixture.file("video.mp4");
    let media = VideoStream::new().unwrap();
    assert_eq!(media.address.ip(), Ipv4Addr::LOCALHOST);
    assert_ne!(media.address.port(), 0);
    assert_eq!(media.shared.token.len(), 64);
    media
        .register(
            CourseRoot {
                course_id: 1,
                root_path: fixture.root.to_str().unwrap().into(),
            },
            &|_| true,
        )
        .unwrap();
    let url = media.lesson_url(1, "video.mp4").unwrap();
    let route = url
        .strip_prefix(&format!("http://{}", media.address))
        .unwrap();
    let head = String::from_utf8(network_request(&media, route, "HEAD", "")).unwrap();
    assert!(head.starts_with("HTTP/1.1 200"));
    assert!(head.to_ascii_lowercase().contains("content-length: 10\r\n"));
    assert!(head.ends_with("\r\n\r\n"));
    let file = File::create(fixture.root.join("large.mp4")).unwrap();
    file.set_len(32 * 1024 * 1024).unwrap();
    let large = media.lesson_url(1, "large.mp4").unwrap();
    let large_route = large
        .strip_prefix(&format!("http://{}", media.address))
        .unwrap();
    for _ in 0..8 {
        let mut socket = TcpStream::connect(media.address).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        write!(
            socket,
            "GET {large_route} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
            media.address
        )
        .unwrap();
        let mut first_bytes = [0_u8; 128];
        assert!(socket.read(&mut first_bytes).unwrap() > 0);
        // Dropping with unread data cancels the response, as a seek does.
    }
    let response = network_request(&media, route, "GET", "Range: bytes=7-\r\n");
    assert!(response.starts_with(b"HTTP/1.1 206"));
    assert!(response.ends_with(b"789"));
    let next = VideoStream::new().unwrap();
    assert!(!bool::from(
        media
            .shared
            .token
            .as_bytes()
            .ct_eq(next.shared.token.as_bytes())
    ));
    let response = network_request(&next, route, "GET", "");
    assert!(response.starts_with(b"HTTP/1.1 403"));
}
