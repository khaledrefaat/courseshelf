//! Fixed-provider transport; keys never leave session memory. No generic HTTP/fs IPC.
mod http;
mod source;
mod storage;

use serde::{Deserialize, Serialize};
use source::{Lesson, Source};
use std::{
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};
use tauri::Manager;

const PROMPT: &str = "flashcards-trial-8";
const VALIDATOR: &str = "flashcards-validator-7";

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Message {
    role: String,
    content: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Usage {
    prompt_tokens: u64,
    completion_tokens: u64,
    total_tokens: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Reply {
    content: String,
    usage: Option<Usage>,
    model: String,
    finish_reason: String,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Bounds {
    first_cue: usize,
    last_cue: usize,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Record {
    stage: String,
    status: String,
    hash: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Checkpoint {
    version: u8,
    id: String,
    lesson: Lesson,
    source_hash: String,
    source_fingerprint: String,
    model: String,
    prompt_version: String,
    validator_version: String,
    sections: Vec<Bounds>,
    requests: Vec<Record>,
}

impl Checkpoint {
    fn stage(&self, index: usize) -> String {
        if index < self.sections.len() {
            format!("section-{}", index + 1)
        } else {
            "selection".into()
        }
    }
    fn validate(&self) -> Result<(), String> {
        if self.prompt_version != PROMPT || self.validator_version != VALIDATOR {
            return Err("This checkpoint uses a different flashcard prompt/validator version. Saved cards and partial responses were kept. Explicitly discard/start over to use the new prompt; this may repeat API charges.".into());
        }
        if self.version != 1
            || !valid_id(&self.id)
            || !valid_id(&self.source_hash)
            || !valid_id(&self.source_fingerprint)
            || self.lesson.course_id <= 0
            || self.lesson.lesson_id <= 0
            || self.lesson.relative_path.len() > 4096
            || self.model != http::MODEL
            || !valid_bounds(&self.sections)
            || self.requests.len() > self.sections.len() + 1
        {
            return Err("Unsupported or malformed flashcard checkpoint.".into());
        }
        for (index, record) in self.requests.iter().enumerate() {
            if record.stage != self.stage(index)
                || !matches!(record.status.as_str(), "started" | "received")
                || (record.status == "received" && !record.hash.as_deref().is_some_and(valid_id))
                || (record.status == "started"
                    && (index + 1 != self.requests.len() || record.hash.is_some()))
            {
                return Err("Invalid checkpoint stage sequence.".into());
            }
        }
        Ok(())
    }
    fn resumable(&self) -> bool {
        self.requests
            .iter()
            .all(|record| record.status == "received")
    }
}

fn valid_id(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn valid_bounds(sections: &[Bounds]) -> bool {
    !sections.is_empty()
        && sections.len() <= 8
        && sections[0].first_cue == 1
        && sections
            .iter()
            .all(|section| section.first_cue <= section.last_cue && section.last_cue <= 10_000)
        && sections
            .windows(2)
            .all(|pair| pair[0].last_cue + 1 == pair[1].first_cue)
}

fn resume_checkpoint(
    dir: &Path,
    lesson: &Lesson,
    source: &Source,
    sections: &[Bounds],
) -> Result<Checkpoint, String> {
    let mut saved = storage::load(dir)?.ok_or("No checkpoint to resume.")?;
    if !saved.resumable()
        || saved.lesson.course_id != lesson.course_id
        || saved.lesson.lesson_id != lesson.lesson_id
        || saved.lesson.relative_path != lesson.relative_path
        || saved.source_hash != source.source_hash
        || saved.source_fingerprint != source.source_fingerprint
        || saved.sections != sections
    {
        return Err("Checkpoint is outdated or has an uncertain request. It cannot be resumed automatically.".into());
    }
    storage::replies(dir, &saved)?;
    // Every publication gets a new identity, including a fully cached resume.
    // A leftover checkpoint must not let an old review edit target replacement rows.
    saved.id = storage::random_id()?;
    storage::save(dir, &saved)?;
    Ok(saved)
}

struct Prepared {
    id: String,
    lesson: Lesson,
    source: Source,
}
struct Job {
    id: String,
    lesson: Lesson,
    source: Source,
    directory: PathBuf,
    checkpoint: Mutex<Checkpoint>,
    cancelled: AtomicBool,
    in_flight: AtomicBool,
    abort: Mutex<Option<Box<dyn Fn() + Send + Sync>>>,
}
impl Job {
    fn check(&self) -> Result<(), String> {
        if self.cancelled.load(Ordering::SeqCst) {
            Err("Flashcard job cancelled. An in-flight request may still consume credits.".into())
        } else {
            Ok(())
        }
    }
    fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        if let Some(abort) = self
            .abort
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            abort();
        }
    }
}

#[derive(Default)]
pub struct Flashcards {
    key: Mutex<Option<String>>,
    prepared: Mutex<Vec<Prepared>>,
    job: Mutex<Option<Arc<Job>>>,
    claiming: AtomicBool,
    epoch: AtomicU64,
}
impl Flashcards {
    fn job(&self, id: &str) -> Result<Arc<Job>, String> {
        self.job
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .filter(|job| job.id == id)
            .cloned()
            .ok_or("Flashcard job no longer exists.".into())
    }
    fn cancel(&self, course: Option<i64>) {
        self.epoch.fetch_add(1, Ordering::SeqCst);
        let mut prepared = self.prepared.lock().unwrap_or_else(|e| e.into_inner());
        prepared.retain(|p| course.is_some_and(|id| id != p.lesson.course_id));
        if let Some(job) = self.job.lock().unwrap_or_else(|e| e.into_inner()).as_ref()
            && course.is_none_or(|id| id == job.lesson.course_id)
        {
            job.cancel();
        }
    }
}
struct Flag<'a>(&'a AtomicBool);
impl Drop for Flag<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
fn main(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window
        .url()
        .is_ok_and(|url| allowed_document(window.label(), &url, tauri::is_dev()))
    {
        Ok(())
    } else {
        Err("Flashcards are available only in the main window.".into())
    }
}
fn allowed_document(label: &str, url: &reqwest::Url, development: bool) -> bool {
    label == "main"
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && matches!(url.path(), "" | "/" | "/index.html")
        && ((url.scheme() == "tauri"
            && url.host_str() == Some("localhost")
            && url.port().is_none())
            || (url.scheme() == "http"
                && url.host_str() == Some("tauri.localhost")
                && url.port().is_none())
            || (development
                && url.scheme() == "http"
                && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
                && url.port() == Some(1420)))
}
fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|_| "App data unavailable.".into())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resume {
    checkpoint: Checkpoint,
    replies: Vec<Reply>,
    resumable: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preparation {
    id: String,
    source: Source,
    resume: Option<Resume>,
    checkpoint_error: Option<String>,
}

#[tauri::command]
pub fn flashcards_key(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Flashcards>,
    key: Option<String>,
) -> Result<bool, String> {
    main(&window)?;
    if let Some(key) = key {
        if key.is_empty() {
            state.cancel(None);
            *state.key.lock().unwrap_or_else(|e| e.into_inner()) = None;
        } else {
            if !(10..=512).contains(&key.len()) || !key.bytes().all(|byte| byte.is_ascii_graphic())
            {
                return Err("Enter a valid API key without spaces.".into());
            }
            *state.key.lock().unwrap_or_else(|e| e.into_inner()) = Some(key);
        }
    }
    Ok(state
        .key
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_some())
}

#[tauri::command]
pub async fn flashcards_prepare(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    lesson: Lesson,
    inspect_checkpoint: bool,
) -> Result<Preparation, String> {
    main(&window)?;
    let state = app.state::<Flashcards>();
    let epoch = state.epoch.load(Ordering::SeqCst);
    let source = source::load(&app, &lesson).await?;
    let id = storage::random_id()?;
    let data = root(&app)?;
    let identity = lesson.clone();
    let (resume, checkpoint_error) = if inspect_checkpoint {
        tauri::async_runtime::spawn_blocking(move || {
            let result = (|| {
                let dir = storage::lesson_dir(&data, identity.course_id, identity.lesson_id)?;
                storage::load(&dir)?
                    .map(|checkpoint| {
                        let replies = storage::replies(&dir, &checkpoint)?;
                        Ok(Resume {
                            resumable: checkpoint.resumable(),
                            checkpoint,
                            replies,
                        })
                    })
                    .transpose()
            })();
            match result {
                Ok(resume) => (resume, None),
                Err(error) => (None, Some(error)),
            }
        })
        .await
        .map_err(|_| "Could not inspect flashcard checkpoint.")?
    } else {
        (None, None)
    };
    if epoch != state.epoch.load(Ordering::SeqCst) {
        return Err("Course changed while preparing flashcards.".into());
    }
    if inspect_checkpoint {
        let mut preparations = state.prepared.lock().unwrap_or_else(|e| e.into_inner());
        if preparations.len() >= 8 {
            preparations.remove(0);
        }
        preparations.push(Prepared {
            id: id.clone(),
            lesson,
            // Keep only fingerprints between preparation and confirmation, not up
            // to eight copies of private transcript text.
            source: Source {
                content: String::new(),
                ..source.clone()
            },
        });
    }
    Ok(Preparation {
        id,
        source,
        resume,
        checkpoint_error,
    })
}

#[tauri::command]
pub async fn flashcards_begin(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    prepared_id: String,
    sections: Vec<Bounds>,
    resume: bool,
) -> Result<String, String> {
    main(&window)?;
    if !valid_bounds(&sections) {
        return Err("Invalid flashcard section bounds.".into());
    }
    let state = app.state::<Flashcards>();
    if state.claiming.swap(true, Ordering::SeqCst) {
        return Err("Another flashcard operation is starting.".into());
    }
    let _claim = Flag(&state.claiming);
    if state
        .job
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_some()
    {
        return Err("Another flashcard job is active.".into());
    }
    let epoch = state.epoch.load(Ordering::SeqCst);
    let (lesson, source) = {
        let prepared = state.prepared.lock().unwrap_or_else(|e| e.into_inner());
        let prepared = prepared
            .iter()
            .find(|p| p.id == prepared_id)
            .ok_or("Preparation expired. Reopen Generate flashcards.")?;
        (prepared.lesson.clone(), prepared.source.clone())
    };
    let fresh = source::load(&app, &lesson).await?;
    if fresh.source_hash != source.source_hash
        || fresh.source_fingerprint != source.source_fingerprint
    {
        return Err("Transcript or video changed. Prepare flashcards again.".into());
    }
    let data = root(&app)?;
    let identity = lesson.clone();
    let original = source.clone();
    let (directory, checkpoint) =
        tauri::async_runtime::spawn_blocking(move || -> Result<_, String> {
            let dir = storage::lesson_dir(&data, identity.course_id, identity.lesson_id)?;
            let checkpoint = if resume {
                resume_checkpoint(&dir, &identity, &original, &sections)?
            } else {
                storage::clear(&dir)?;
                let saved = Checkpoint {
                    version: 1,
                    id: storage::random_id()?,
                    lesson: identity,
                    source_hash: original.source_hash,
                    source_fingerprint: original.source_fingerprint,
                    model: http::MODEL.into(),
                    prompt_version: PROMPT.into(),
                    validator_version: VALIDATOR.into(),
                    sections,
                    requests: Vec::new(),
                };
                storage::save(&dir, &saved)?;
                saved
            };
            Ok((dir, checkpoint))
        })
        .await
        .map_err(|_| "Could not initialize flashcard checkpoint.")??;
    if epoch != state.epoch.load(Ordering::SeqCst) {
        return Err("Flashcard preparation was cancelled.".into());
    }
    let id = checkpoint.id.clone();
    *state.job.lock().unwrap_or_else(|e| e.into_inner()) = Some(Arc::new(Job {
        id: id.clone(),
        lesson,
        source,
        directory,
        checkpoint: Mutex::new(checkpoint),
        cancelled: AtomicBool::new(false),
        in_flight: AtomicBool::new(false),
        abort: Mutex::new(None),
    }));
    Ok(id)
}

#[tauri::command]
pub async fn flashcards_request(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    job_id: String,
    stage: String,
    messages: Vec<Message>,
) -> Result<Reply, String> {
    main(&window)?;
    if !http::messages_valid(&messages) {
        return Err("Invalid or oversized flashcard messages.".into());
    }
    let state = app.state::<Flashcards>();
    let job = state.job(&job_id)?;
    job.check()?;
    if job.in_flight.swap(true, Ordering::SeqCst) {
        return Err("A flashcard request is already running.".into());
    }
    let _request = Flag(&job.in_flight);
    let key = state
        .key
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
        .ok_or("Enter your API key for this session first.")?;
    let handle = app.clone();
    let item = job.clone();
    let index = tauri::async_runtime::spawn_blocking(move || -> Result<usize, String> {
        item.check()?;
        if source::fingerprint(&handle, &item.lesson)? != item.source.source_fingerprint {
            return Err("Lesson changed during flashcard generation.".into());
        }
        let mut checkpoint = item.checkpoint.lock().unwrap_or_else(|e| e.into_inner());
        let index = checkpoint.requests.len();
        if !checkpoint.resumable()
            || index > checkpoint.sections.len()
            || stage != checkpoint.stage(index)
        {
            return Err(
                "Request stage is out of order or was already attempted. No retry was sent.".into(),
            );
        }
        checkpoint.requests.push(Record {
            stage,
            status: "started".into(),
            hash: None,
        });
        storage::save(&item.directory, &checkpoint)?;
        Ok(index)
    })
    .await
    .map_err(|_| "Could not record flashcard request.")??;
    job.check()?;
    let task = tauri::async_runtime::spawn(http::request(key, messages));
    let abort = task.inner().abort_handle();
    *job.abort.lock().unwrap_or_else(|e| e.into_inner()) = Some(Box::new(move || abort.abort()));
    if job.cancelled.load(Ordering::SeqCst) {
        job.cancel();
    }
    let reply = task
        .await
        .map_err(|_| "Flashcard request cancelled or interrupted; usage may be unknown.")?;
    *job.abort.lock().unwrap_or_else(|e| e.into_inner()) = None;
    let reply = reply?;
    let item = job.clone();
    let received = reply.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let digest = storage::save_reply(&item.directory, index, &received)?;
        let mut checkpoint = item.checkpoint.lock().unwrap_or_else(|e| e.into_inner());
        checkpoint.requests[index].status = "received".into();
        checkpoint.requests[index].hash = Some(digest);
        storage::save(&item.directory, &checkpoint)
    })
    .await
    .map_err(|_| "Could not checkpoint the received response; usage may have been consumed.")??;
    job.check()?;
    Ok(reply)
}

#[tauri::command]
pub fn flashcards_cancel(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Flashcards>,
    course_id: Option<i64>,
) -> Result<(), String> {
    main(&window)?;
    state.cancel(course_id);
    Ok(())
}

#[tauri::command]
pub async fn flashcards_validate_job(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    job_id: String,
) -> Result<(), String> {
    main(&window)?;
    let job = app.state::<Flashcards>().job(&job_id)?;
    job.check()?;
    let fresh = source::load(&app, &job.lesson).await?;
    job.check()?;
    if fresh.source_hash != job.source.source_hash
        || fresh.source_fingerprint != job.source.source_fingerprint
    {
        return Err("Video or transcript changed. Existing cards were not replaced.".into());
    }
    let checkpoint = job.checkpoint.lock().unwrap_or_else(|e| e.into_inner());
    if !checkpoint.resumable() || checkpoint.requests.len() < checkpoint.sections.len() {
        return Err("Flashcard generation is incomplete.".into());
    }
    if checkpoint.sections.len() > 1 && checkpoint.requests.len() != checkpoint.sections.len() + 1 {
        return Err("Whole-lesson selection has not completed.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn flashcards_finish(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    job_id: String,
    saved: bool,
) -> Result<(), String> {
    main(&window)?;
    let state = app.state::<Flashcards>();
    let job = state.job(&job_id)?;
    if job.in_flight.load(Ordering::SeqCst) {
        return Err("Wait for the flashcard request to settle first.".into());
    }
    job.cancel();
    let result = if saved {
        let dir = job.directory.clone();
        tauri::async_runtime::spawn_blocking(move || storage::clear(&dir))
            .await
            .map_err(|_| "Cards saved, but checkpoint cleanup failed.".to_owned())?
    } else {
        Ok(())
    };
    let mut slot = state.job.lock().unwrap_or_else(|e| e.into_inner());
    if slot.as_ref().is_some_and(|current| current.id == job_id) {
        *slot = None;
    }
    result
}

#[tauri::command]
pub async fn flashcards_discard(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    course_id: i64,
    lesson_id: Option<i64>,
) -> Result<(), String> {
    main(&window)?;
    if course_id <= 0 {
        return Err("Invalid course.".into());
    }
    if app
        .state::<Flashcards>()
        .job
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .is_some_and(|job| job.lesson.course_id == course_id)
    {
        return Err("Cancel the active flashcard job first.".into());
    }
    let data = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(lesson) = lesson_id {
            storage::clear(&storage::lesson_dir(&data, course_id, lesson)?)
        } else {
            storage::clean_course(&data, course_id)
        }
    })
    .await
    .map_err(|_| "Could not clean flashcard checkpoints.")?
}

pub fn cancel_on_close(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<Flashcards>() {
        state.cancel(None);
        *state.key.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }
}

#[cfg(test)]
mod tests;
