use super::storage::hash;
use serde::{Deserialize, Serialize};
use std::{fs, time::UNIX_EPOCH};
use tauri::Manager;
use tauri_plugin_fs::FsExt;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Lesson {
    pub course_id: i64,
    pub lesson_id: i64,
    pub relative_path: String,
    pub generated: Option<crate::subtitle_generation::GeneratedSubtitle>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub content: String,
    pub filename: String,
    pub source_hash: String,
    pub source_fingerprint: String,
}

pub fn fingerprint(app: &tauri::AppHandle, lesson: &Lesson) -> Result<String, String> {
    if lesson.course_id <= 0 || lesson.lesson_id <= 0 || lesson.relative_path.len() > 4096 {
        return Err("Invalid flashcard lesson.".into());
    }
    let dir = app
        .state::<crate::video_stream::VideoStream>()
        .lesson_directory(lesson.course_id, &lesson.relative_path)
        .map_err(|_| "Lesson is unavailable. Locate the course folder first.")?;
    let name = lesson
        .relative_path
        .rsplit('/')
        .next()
        .ok_or("Invalid lesson path.")?;
    let path = dir.join(name);
    let meta = fs::symlink_metadata(&path).map_err(|_| "Lesson is missing or unreadable.")?;
    if !meta.is_file()
        || crate::fs_links::is_link(&meta)
        || !app.fs_scope().is_allowed(&path)
        || fs::canonicalize(&path).ok().as_ref() != Some(&path)
    {
        return Err("Lesson must be a registered, granted regular file.".into());
    }
    // Cheap change detection, not an integrity claim. Generated-cache reads below
    // still perform their existing full source SHA-256 verification.
    let modified = meta
        .modified()
        .map_err(|_| "Lesson timestamp is unavailable.")?
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "Invalid lesson timestamp.")?;
    Ok(hash(
        format!(
            "{}:{}:{}",
            meta.len(),
            modified.as_secs(),
            modified.subsec_nanos()
        )
        .as_bytes(),
    ))
}

pub async fn load(app: &tauri::AppHandle, lesson: &Lesson) -> Result<Source, String> {
    let handle = app.clone();
    let identity = lesson.clone();
    let before = tauri::async_runtime::spawn_blocking(move || fingerprint(&handle, &identity))
        .await
        .map_err(|_| "Could not check the flashcard lesson.")??;
    let sidecar = crate::subtitles::get_lesson_subtitle(
        app.clone(),
        lesson.course_id,
        lesson.relative_path.clone(),
    )
    .await?;
    let (filename, content) = if let Some(subtitle) = sidecar {
        (subtitle.filename, subtitle.content)
    } else if let Some(metadata) = lesson.generated.as_ref() {
        if metadata.lesson_id != lesson.lesson_id {
            return Err("Generated transcript belongs to another lesson.".into());
        }
        let content = crate::subtitle_generation::read_generated_subtitle(
            app.clone(),
            lesson.course_id,
            lesson.relative_path.clone(),
            metadata.clone(),
        )
        .await?
        .ok_or("Generated subtitles are missing or outdated. Generate subtitles first.")?;
        (metadata.filename.clone(), content)
    } else {
        return Err(
            "No transcript found. Generate English subtitles first, then try flashcards.".into(),
        );
    };
    let handle = app.clone();
    let identity = lesson.clone();
    let after = tauri::async_runtime::spawn_blocking(move || fingerprint(&handle, &identity))
        .await
        .map_err(|_| "Could not check the flashcard lesson.")??;
    if before != after {
        return Err("Lesson changed while reading its transcript. Try again.".into());
    }
    Ok(Source {
        source_hash: hash(content.as_bytes()),
        source_fingerprint: after,
        filename,
        content,
    })
}
