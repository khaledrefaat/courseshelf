mod download;
mod export;
mod ffmpeg;
mod model;
mod paths;
mod process;

use paths::*;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::Child,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU8, Ordering},
    },
};
use tauri::Manager;
use tauri_plugin_fs::FsExt;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedSubtitle {
    pub lesson_id: i64,
    pub filename: String,
    pub source_fingerprint: String,
    pub model_id: String,
    pub model_sha256: String,
}

pub struct Job {
    id: String,
    course_id: i64,
    lesson_id: i64,
    cancel: AtomicBool,
    progress: AtomicU8,
    details: Mutex<Details>,
    child: Mutex<Option<Child>>,
}

#[derive(Clone)]
struct Details {
    stage: String,
    percent: bool,
    running: bool,
    result: Option<GeneratedSubtitle>,
    error: Option<String>,
}

impl Job {
    fn stage(&self, stage: &str, percent: Option<u8>) {
        self.progress.store(percent.unwrap_or(0), Ordering::Relaxed);
        let mut details = self.details.lock().unwrap_or_else(|e| e.into_inner());
        details.stage = stage.into();
        details.percent = percent.is_some();
    }
    fn kill(&self) {
        self.cancel.store(true, Ordering::SeqCst);
        if let Some(child) = self
            .child
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_mut()
        {
            let _ = child.kill();
        }
    }
}

#[derive(Default)]
pub struct Generation(Mutex<Option<Arc<Job>>>);

impl Generation {
    fn claim(&self, job: Arc<Job>) -> Result<(), String> {
        let mut slot = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(old) = slot.as_ref() {
            let details = old.details.lock().unwrap_or_else(|e| e.into_inner());
            if details.running || details.result.is_some() {
                return Err("Another subtitle job is active. Finish or cancel it first.".into());
            }
        }
        *slot = Some(job);
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationStatus {
    model_present: bool,
    helpers_present: bool,
    ffmpeg_present: bool,
    ffmpeg_download_bytes: u64,
    job: Option<JobStatus>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobStatus {
    id: String,
    course_id: i64,
    lesson_id: i64,
    stage: String,
    progress: Option<u8>,
    running: bool,
    result: Option<GeneratedSubtitle>,
    error: Option<String>,
}

fn data(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|_| "App data location unavailable.".into())
}
fn resources(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // Tauri's resource resolver maps the same packaged directory on both OSes.
    #[cfg(debug_assertions)]
    {
        let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources");
        if process::helper(&dev, "whisper-cli").is_ok() {
            return Ok(dev);
        }
    }
    app.path()
        .resource_dir()
        .map_err(|_| "App resources unavailable.".into())
}
fn job_directory(root: &Path, job: &Job) -> Result<PathBuf, String> {
    directory(&directory(root, "subtitle-jobs")?, &job.id)
}

fn source_path(app: &tauri::AppHandle, course_id: i64, relative: &str) -> Result<PathBuf, String> {
    let parent = app
        .state::<crate::video_stream::VideoStream>()
        .lesson_directory(course_id, relative)
        .map_err(|_| {
            "Course or lesson is missing or not authorized. Locate its folder first.".to_owned()
        })?;
    let file = relative.rsplit('/').next().ok_or("Invalid lesson path.")?;
    let path = parent.join(file);
    if !app.fs_scope().is_allowed(&path) {
        return Err("FOLDER_NOT_AUTHORIZED: re-pick the course folder.".into());
    }
    if fs::canonicalize(&path).ok().as_ref() != Some(&path) {
        return Err("Lesson path changed or contains a link.".into());
    }
    Ok(path)
}

pub fn cancel_on_close(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<Generation>()
        && let Some(job) = state.0.lock().unwrap_or_else(|e| e.into_inner()).as_ref()
    {
        job.kill();
    }
}

pub fn clean_interrupted(app: &tauri::AppHandle) -> Result<(), String> {
    let root = data(app)?;
    if !root.exists() {
        return Ok(());
    }
    ffmpeg::clean_interrupted(&root)?;
    let jobs = directory(&root, "subtitle-jobs")?;
    for entry in fs::read_dir(jobs).map_err(|_| "Could not check interrupted subtitle jobs.")? {
        let entry = entry.map_err(|_| "Could not check interrupted subtitle job.")?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let meta =
            fs::symlink_metadata(entry.path()).map_err(|_| "Interrupted job unavailable.")?;
        if name.len() == 64
            && name
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            && meta.is_dir()
            && !crate::fs_links::is_link(&meta)
        {
            fs::remove_dir_all(entry.path())
                .map_err(|_| "Could not clean interrupted subtitle job.")?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn validate_generated_subtitle_job(
    app: tauri::AppHandle,
    state: tauri::State<'_, Generation>,
    job_id: String,
) -> Result<String, String> {
    let slot = state.0.lock().unwrap_or_else(|e| e.into_inner());
    let job = slot
        .as_ref()
        .filter(|job| job.id == job_id)
        .ok_or("Subtitle job no longer exists.")?;
    cancelled(&job.cancel)?;
    let details = job.details.lock().unwrap_or_else(|e| e.into_inner());
    if details.running || details.result.is_none() {
        return Err("Subtitles are not ready.".into());
    }
    let path = job_directory(&data(&app)?, job)?.join("generated.vtt");
    if fs::metadata(&path)
        .map_err(|_| "Subtitles unavailable.")?
        .len()
        > MAX_VTT
    {
        return Err("Generated subtitles are too large.".into());
    }
    fs::read_to_string(path).map_err(|_| "Generated subtitles are unreadable.".into())
}

#[tauri::command]
pub fn subtitle_generation_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, Generation>,
) -> Result<GenerationStatus, String> {
    let root = data(&app)?;
    let resource = resources(&app)?;
    let job = state
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(|job| {
            let details = job
                .details
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            JobStatus {
                id: job.id.clone(),
                course_id: job.course_id,
                lesson_id: job.lesson_id,
                stage: details.stage,
                progress: details
                    .percent
                    .then(|| job.progress.load(Ordering::Relaxed)),
                running: details.running,
                result: details.result,
                error: details.error,
            }
        });
    Ok(GenerationStatus {
        model_present: root.join("models/ggml-base.en.bin").is_file(),
        helpers_present: process::helper(&resource, "whisper-cli").is_ok(),
        ffmpeg_present: ffmpeg::present(&root),
        ffmpeg_download_bytes: ffmpeg::download_bytes(),
        job,
    })
}

#[tauri::command]
pub async fn start_subtitle_generation(
    app: tauri::AppHandle,
    course_id: i64,
    lesson_id: i64,
    relative_path: String,
    download_consent: bool,
) -> Result<String, String> {
    if course_id <= 0 || lesson_id <= 0 {
        return Err("Invalid lesson.".into());
    }
    let resource = resources(&app)?;
    process::helper(&resource, "whisper-cli")?;
    let root = data(&app)?;
    let mut random = [0_u8; 32];
    getrandom::fill(&mut random).map_err(|_| "Could not create generation ID.")?;
    let id: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
    let job = Arc::new(Job {
        id: id.clone(),
        course_id,
        lesson_id,
        cancel: AtomicBool::new(false),
        progress: AtomicU8::new(0),
        child: Mutex::new(None),
        details: Mutex::new(Details {
            stage: "Preparing".into(),
            percent: false,
            running: true,
            result: None,
            error: None,
        }),
    });
    app.state::<Generation>().claim(job.clone())?;
    tauri::async_runtime::spawn_blocking(move || {
        let result = (|| {
            // Validate before downloading anything or launching helpers.
            let source = source_path(&app, course_id, &relative_path)?;
            let ffmpeg = ffmpeg::ensure(&root, &job, download_consent)?;
            let model = model::ensure_model(&root, &job, download_consent)?;
            job.stage("Checking video", None);
            let fingerprint = digest_file(&source, &job.cancel)?;
            let temporary = job_directory(&root, &job)?;
            process::transcribe(&resource, &ffmpeg, &source, &model, &temporary, &job)?;
            job.stage("Verifying video", None);
            if source_path(&app, course_id, &relative_path)? != source
                || digest_file(&source, &job.cancel)? != fingerprint
            {
                return Err("The video changed during generation. Please retry.".into());
            }
            cancelled(&job.cancel)?;
            Ok(GeneratedSubtitle {
                lesson_id,
                filename: format!("{lesson_id}-{}.en.vtt", job.id),
                source_fingerprint: fingerprint,
                model_id: format!("whisper.cpp-1.9.5/{MODEL}"),
                model_sha256: MODEL_HASH.into(),
            })
        })();
        let mut details = job.details.lock().unwrap_or_else(|e| e.into_inner());
        details.running = false;
        match result {
            Ok(result) => {
                details.stage = "Saving subtitles".into();
                details.result = Some(result);
            }
            Err(error) => {
                details.stage = if job.cancel.load(Ordering::SeqCst) {
                    "Cancelled"
                } else {
                    "Failed"
                }
                .into();
                details.error = Some(error);
                if let Ok(dir) = job_directory(&root, &job) {
                    let _ = fs::remove_dir_all(dir);
                }
            }
        }
    });
    Ok(id)
}

#[tauri::command]
pub fn cancel_subtitle_generation(
    state: tauri::State<'_, Generation>,
    job_id: Option<String>,
    course_id: Option<i64>,
) -> Result<(), String> {
    if let Some(job) = state.0.lock().unwrap_or_else(|e| e.into_inner()).as_ref()
        && job_id.as_ref().is_none_or(|id| *id == job.id)
        && course_id.is_none_or(|id| id == job.course_id)
    {
        job.kill();
    }
    Ok(())
}

#[tauri::command]
pub fn finish_subtitle_generation(
    app: tauri::AppHandle,
    state: tauri::State<'_, Generation>,
    job_id: String,
    keep: bool,
) -> Result<(), String> {
    let slot = state.0.lock().unwrap_or_else(|e| e.into_inner());
    let job = slot
        .as_ref()
        .filter(|job| job.id == job_id)
        .ok_or("Subtitle job no longer exists.")?;
    let mut details = job.details.lock().unwrap_or_else(|e| e.into_inner());
    if details.running {
        return Err("Subtitle job is still running.".into());
    }
    let root = data(&app)?;
    let temporary = job_directory(&root, job)?;
    if keep {
        cancelled(&job.cancel)?;
        let result = details
            .result
            .as_ref()
            .ok_or("No generated subtitles to save.")?;
        let destination = cache_path(&root, result.lesson_id, &result.filename)?;
        if destination.exists() {
            return Err("Generated subtitle destination already exists.".into());
        }
        fs::rename(temporary.join("generated.vtt"), destination)
            .map_err(|_| "Could not save generated subtitles.")?;
    }
    details.result = None;
    details.stage = if keep { "Completed" } else { "Cancelled" }.into();
    if fs::remove_dir_all(temporary).is_err() {
        details.error = Some(
            "Subtitles processed, but temporary cleanup failed. Restart to retry cleanup.".into(),
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn read_generated_subtitle(
    app: tauri::AppHandle,
    course_id: i64,
    relative_path: String,
    metadata: GeneratedSubtitle,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if metadata.model_sha256 != MODEL_HASH {
            return Ok(None);
        }
        let source = source_path(&app, course_id, &relative_path)?;
        if digest_file(&source, &AtomicBool::new(false))? != metadata.source_fingerprint {
            return Ok(None);
        }
        let path = cache_path(&data(&app)?, metadata.lesson_id, &metadata.filename)?;
        let Ok(info) = fs::symlink_metadata(&path) else {
            return Ok(None);
        };
        if !info.is_file()
            || crate::fs_links::is_link(&info)
            || info.len() > MAX_VTT
            || fs::canonicalize(&path).ok().as_ref() != Some(&path)
        {
            return Err("Unsafe generated subtitle cache file.".into());
        }
        let mut text = String::new();
        fs::File::open(path)
            .and_then(|file| file.take(MAX_VTT + 1).read_to_string(&mut text))
            .map_err(|_| "Could not read generated subtitles.")?;
        if text.len() as u64 > MAX_VTT {
            return Err("Generated subtitles exceed the size limit.".into());
        }
        Ok(Some(text))
    })
    .await
    .map_err(|_| "Could not load generated subtitles.".to_owned())?
}

#[tauri::command]
pub fn remove_generated_subtitle(
    app: tauri::AppHandle,
    lesson_id: i64,
    filename: String,
) -> Result<(), String> {
    remove_cache(&data(&app)?, lesson_id, &filename)
}

#[tauri::command]
pub async fn export_generated_subtitle(
    app: tauri::AppHandle,
    course_id: i64,
    relative_path: String,
    metadata: GeneratedSubtitle,
) -> Result<String, String> {
    // Preserve any matching VTT/SRT, not only the chosen .en.vtt destination.
    if crate::subtitles::get_lesson_subtitle(app.clone(), course_id, relative_path.clone())
        .await?
        .is_some()
    {
        return Ok("existing".into());
    }
    let text = read_generated_subtitle(app.clone(), course_id, relative_path.clone(), metadata)
        .await?
        .ok_or("Generated subtitles are missing or stale. Generate them again.")?;
    tauri::async_runtime::spawn_blocking(move || {
        let source = source_path(&app, course_id, &relative_path)?;
        let parent = source.parent().ok_or("Invalid lesson folder.")?;
        export::write(&source, &text, |target| {
            if source_path(&app, course_id, &relative_path)? != source
                || target.parent() != Some(parent)
                || !app.fs_scope().is_allowed(target)
            {
                return Err("FOLDER_NOT_AUTHORIZED: the course folder changed; re-pick it.".into());
            }
            Ok(())
        })
        .map(str::to_owned)
    })
    .await
    .map_err(|_| "Subtitle export could not finish.".to_owned())?
}

#[cfg(test)]
pub(super) fn fixture_job() -> Arc<Job> {
    Arc::new(Job {
        id: "a".repeat(64),
        course_id: 1,
        lesson_id: 1,
        cancel: AtomicBool::new(false),
        progress: AtomicU8::new(0),
        child: Mutex::new(None),
        details: Mutex::new(Details {
            stage: "Preparing".into(),
            percent: false,
            running: true,
            result: None,
            error: None,
        }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn admits_one_job_and_requires_finalization_before_replacing_ready_output() {
        let manager = Generation::default();
        let job = fixture_job();
        manager.claim(job.clone()).unwrap();
        assert!(manager.claim(fixture_job()).is_err());
        {
            let mut details = job.details.lock().unwrap();
            details.running = false;
            details.result = Some(GeneratedSubtitle {
                lesson_id: 1,
                filename: "test".into(),
                source_fingerprint: "hash".into(),
                model_id: MODEL.into(),
                model_sha256: MODEL_HASH.into(),
            });
        }
        assert!(manager.claim(fixture_job()).is_err());
        job.details.lock().unwrap().result = None;
        manager.claim(fixture_job()).unwrap();
    }
    #[test]
    fn cancellation_is_explicit_and_does_not_depend_on_a_live_player() {
        let job = fixture_job();
        assert!(cancelled(&job.cancel).is_ok());
        job.kill();
        assert!(cancelled(&job.cancel).is_err());
    }
}
