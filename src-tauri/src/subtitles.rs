//! Sidecar-only subtitle reads. Never modifies a course or exposes a file URL.
use serde::Serialize;
use std::{fs, io::Read, path::Path};
use tauri::Manager;
use tauri_plugin_fs::FsExt;

const MAX_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Serialize)]
pub struct Subtitle {
    filename: String,
    content: String,
}

fn rank(video_stem: &str, filename: &str) -> Option<u8> {
    let (stem, extension) = filename.rsplit_once('.')?;
    let format = match extension.to_ascii_lowercase().as_str() {
        "vtt" => 0,
        "srt" => 1,
        _ => return None,
    };
    // Preserve case in lesson names: Linux can contain two distinct case variants.
    if stem == video_stem {
        return Some(format);
    }
    let suffix = stem
        .strip_prefix(video_stem)?
        .strip_prefix('.')?
        .to_ascii_lowercase();
    if suffix == "en" || suffix == "english" || suffix == "en-us" || suffix == "en-gb" {
        Some(2 + format)
    } else {
        None
    }
}

fn decode(bytes: Vec<u8>) -> Result<String, String> {
    if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        if !bytes.len().is_multiple_of(2) {
            return Err("Subtitle has invalid UTF-16 text.".into());
        }
        let little = bytes[0] == 0xff;
        let units: Vec<_> = bytes[2..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| {
                if little {
                    u16::from_le_bytes([pair[0], pair[1]])
                } else {
                    u16::from_be_bytes([pair[0], pair[1]])
                }
            })
            .collect();
        return String::from_utf16(&units).map_err(|_| "Subtitle has invalid UTF-16 text.".into());
    }
    String::from_utf8(bytes)
        .map(|text| text.trim_start_matches('\u{feff}').to_owned())
        .map_err(|_| "Subtitle must use UTF-8 or UTF-16 with a byte-order mark.".into())
}

fn read_sidecar(
    directory: &Path,
    lesson: &str,
    allowed: &impl Fn(&Path) -> bool,
) -> Result<Option<Subtitle>, String> {
    if !allowed(directory)
        || crate::fs_links::is_link(
            &fs::symlink_metadata(directory).map_err(|_| "Subtitle folder is unreadable.")?,
        )
    {
        return Err("Subtitle folder is not authorized or is a link.".into());
    }
    let canonical_directory =
        fs::canonicalize(directory).map_err(|_| "Subtitle folder is unreadable.")?;
    if canonical_directory != directory || !allowed(&canonical_directory) {
        return Err("Subtitle folder changed; register the course again.".into());
    }
    let stem = Path::new(lesson)
        .file_stem()
        .and_then(|name| name.to_str())
        .ok_or("Invalid lesson filename.")?;
    let mut candidates = Vec::new();
    for entry in fs::read_dir(directory).map_err(|_| "Subtitle folder is unreadable.")? {
        let entry = entry.map_err(|_| "Could not read subtitle folder entry.")?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if let Some(priority) = rank(stem, &name) {
            candidates.push((priority, name));
        }
    }
    candidates.sort();
    let Some((_, filename)) = candidates.into_iter().next() else {
        return Ok(None);
    };
    let path = directory.join(&filename);
    let validate = || -> Result<fs::Metadata, String> {
        let metadata = fs::symlink_metadata(&path).map_err(|_| "Subtitle is unreadable.")?;
        if crate::fs_links::is_link(&metadata) || !metadata.is_file() || !allowed(&path) {
            return Err("Subtitle must be an authorized regular file, not a link.".into());
        }
        if fs::canonicalize(&path).map_err(|_| "Subtitle is unreadable.")? != path {
            return Err("Subtitle path changed or escaped its folder.".into());
        }
        if metadata.len() > MAX_BYTES {
            return Err("Subtitle exceeds the 2 MB limit.".into());
        }
        Ok(metadata)
    };
    validate()?;
    let file = fs::File::open(&path).map_err(|_| "Subtitle is unreadable.")?;
    let opened = file
        .metadata()
        .map_err(|_| "Subtitle metadata unavailable.")?;
    let current = validate()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if opened.ino() != current.ino() || opened.dev() != current.dev() {
            return Err("Subtitle changed while opening.".into());
        }
    }
    if !opened.is_file() || current.len() > MAX_BYTES {
        return Err("Invalid subtitle file.".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read subtitle.")?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("Subtitle exceeds the 2 MB limit.".into());
    }
    validate()?;
    Ok(Some(Subtitle {
        filename,
        content: decode(bytes)?,
    }))
}

#[tauri::command]
pub async fn get_lesson_subtitle(
    app: tauri::AppHandle,
    course_id: i64,
    relative_path: String,
) -> Result<Option<Subtitle>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let directory = app
            .state::<crate::video_stream::VideoStream>()
            .lesson_directory(course_id, &relative_path)
            .map_err(|_| "Course or lesson is unavailable for subtitles.".to_owned())?;
        read_sidecar(&directory, &relative_path, &|path| {
            app.fs_scope().is_allowed(path)
        })
    })
    .await
    .map_err(|_| "Subtitle read could not finish.".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ranks_exact_before_english_and_vtt_before_srt_without_cross_lesson_matches() {
        assert_eq!(rank("01. Intro", "01. Intro.vtt"), Some(0));
        assert_eq!(rank("01. Intro", "01. Intro.srt"), Some(1));
        assert_eq!(rank("01. Intro", "01. Intro.en.VTT"), Some(2));
        assert_eq!(rank("01. Intro", "01. Intro.en-US.srt"), Some(3));
        assert_eq!(rank("01. Intro", "01. Introduction.vtt"), None);
        assert_eq!(rank("01. Intro", "01. Intro.fr.vtt"), None);
    }
    #[test]
    fn reads_unicode_names_and_bounded_encoded_text_and_rejects_denied_files() {
        let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/subtitle-tests");
        fs::create_dir_all(&base).unwrap();
        let base = fs::canonicalize(base).unwrap();
        let name = "درس # % + ?.en.vtt";
        // '?' is not a legal Windows filename.
        let name = name.replace('?', "spaces");
        fs::write(
            base.join(&name),
            "\u{feff}WEBVTT\n\n00:00.000 --> 00:01.000\nمرحبا Hello",
        )
        .unwrap();
        let result = read_sidecar(&base, "درس # % + spaces.mp4", &|_| true)
            .unwrap()
            .unwrap();
        assert!(result.content.starts_with("WEBVTT"));
        assert!(result.content.contains("مرحبا Hello"));
        let exact_srt = base.join("درس # % + spaces.srt");
        fs::write(&exact_srt, "exact SRT").unwrap();
        assert_eq!(
            read_sidecar(&base, "درس # % + spaces.mp4", &|_| true)
                .unwrap()
                .unwrap()
                .content,
            "exact SRT"
        );
        let exact_vtt = base.join("درس # % + spaces.vtt");
        fs::write(&exact_vtt, "exact VTT").unwrap();
        assert_eq!(
            read_sidecar(&base, "درس # % + spaces.mp4", &|_| true)
                .unwrap()
                .unwrap()
                .content,
            "exact VTT"
        );
        assert!(read_sidecar(&base, "درس # % + spaces.mp4", &|path| path != exact_vtt).is_err());
        fs::remove_file(exact_srt).unwrap();
        fs::remove_file(exact_vtt).unwrap();
        assert!(read_sidecar(&base, "درس # % + spaces.mp4", &|_| false).is_err());
        assert!(
            read_sidecar(&base, "other.mp4", &|_| true)
                .unwrap()
                .is_none()
        );
        let huge = base.join("huge.srt");
        fs::File::create(&huge)
            .unwrap()
            .set_len(MAX_BYTES + 1)
            .unwrap();
        assert!(read_sidecar(&base, "huge.mp4", &|_| true).is_err());
        fs::remove_file(huge).unwrap();
        fs::remove_file(base.join(name)).unwrap();
        assert_eq!(decode(vec![0xff, 0xfe, 65, 0]).unwrap(), "A");
        assert!(decode(vec![0xff]).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn refuses_symlinked_subtitles() {
        use std::os::unix::fs::symlink;
        let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/subtitle-link-test");
        fs::create_dir_all(&base).unwrap();
        let base = fs::canonicalize(base).unwrap();
        let outside = base.join("outside.txt");
        fs::write(&outside, "secret").unwrap();
        let link = base.join("lesson.vtt");
        symlink(&outside, &link).unwrap();
        assert!(read_sidecar(&base, "lesson.mp4", &|_| true).is_err());
        fs::remove_file(link).unwrap();
        fs::remove_file(outside).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn refuses_junctions_as_sidecars_and_subtitle_directories() {
        let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/subtitle-junction-test");
        fs::create_dir_all(base.join("real")).unwrap();
        let base = fs::canonicalize(base).unwrap();
        let target = base.join("real");
        fs::write(target.join("lesson.vtt"), "WEBVTT").unwrap();
        let folder = base.join("linked");
        crate::fs_links::test_junction(&target, &folder);
        assert!(read_sidecar(&folder, "lesson.mp4", &|_| true).is_err());
        fs::remove_dir(folder).unwrap();
        let file = base.join("lesson.vtt");
        crate::fs_links::test_junction(&target, &file);
        assert!(read_sidecar(&base, "lesson.mp4", &|_| true).is_err());
        fs::remove_dir(file).unwrap();
        fs::remove_file(target.join("lesson.vtt")).unwrap();
        fs::remove_dir(target).unwrap();
    }
}
