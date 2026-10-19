use super::paths::MAX_VTT;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

fn destination(source: &Path) -> Result<PathBuf, String> {
    let extension = source
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "mp4" | "m4v" | "webm") {
        return Err("Not a video lesson.".into());
    }
    let stem = source
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("Invalid lesson filename.")?;
    Ok(source.with_file_name(format!("{stem}.en.vtt")))
}

// The caller validates the registered lesson/root and persisted scope each time.
// hard_link publishes a complete file exclusively on Linux and Windows (no replace).
// If unsupported (e.g. exFAT), fail visibly and retain the app-data cache.
pub fn write(
    source: &Path,
    text: &str,
    validate: impl Fn(&Path) -> Result<(), String>,
) -> Result<&'static str, String> {
    if text.len() as u64 > MAX_VTT || !text.starts_with("WEBVTT") || !text.contains("-->") {
        return Err("Generated subtitles are invalid or exceed the size limit.".into());
    }
    let target = destination(source)?;
    validate(&target)?;
    match fs::symlink_metadata(&target) {
        Ok(_) => return Ok("existing"), // Includes links: never open or overwrite them.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err("Could not check the subtitle destination.".into()),
    }
    let parent = source.parent().ok_or("Invalid course folder.")?;
    let mut random = [0_u8; 32];
    getrandom::fill(&mut random).map_err(|_| "Could not create export identifier.")?;
    let id: String = random.iter().map(|b| format!("{b:02x}")).collect();
    let temporary = parent.join(format!("courseshelf-subtitle-{id}.tmp"));
    validate(&temporary)?;
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|_| "Could not create subtitle file. The course folder may be read-only.")?;
    let result: Result<&'static str, String> = (|| {
        file.write_all(text.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|_| "Could not finish writing subtitles. Check disk space.")?;
        validate(&target)?;
        match fs::hard_link(&temporary, &target) {
            Ok(()) => Ok("saved"),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok("existing"),
            Err(_) => Err("Could not publish subtitles safely. The folder may be read-only or its filesystem may not support hard links (for example exFAT). Subtitles remain in Courseshelf.".into()),
        }
    })();
    drop(file);
    if fs::remove_file(&temporary).is_err() {
        return Err(format!(
            "{} Temporary subtitle cleanup also failed: {}",
            result
                .as_ref()
                .map_or_else(|e| e.as_str(), |status| *status),
            temporary.file_name().unwrap_or_default().to_string_lossy()
        ));
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    const VTT: &str = "WEBVTT\n\n00:00.000 --> 00:01.000\nHello مرحبا\n";
    fn fixture(name: &str) -> PathBuf {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(name);
        fs::create_dir_all(&path).unwrap();
        fs::canonicalize(path).unwrap()
    }
    #[test]
    fn writes_complete_unicode_sidecar_without_changing_videos_or_overwriting_subtitles() {
        let root = fixture("subtitle-export-test");
        let video = root.join("01 درس # % + spaces.mp4");
        fs::write(&video, "original video").unwrap();
        assert_eq!(write(&video, VTT, |_| Ok(())).unwrap(), "saved");
        let target = destination(&video).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), VTT);
        assert_eq!(
            write(&video, "WEBVTT\n-->\nreplacement", |_| Ok(())).unwrap(),
            "existing"
        );
        assert_eq!(fs::read_to_string(&target).unwrap(), VTT);
        assert_eq!(fs::read_to_string(&video).unwrap(), "original video");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
        fs::remove_file(target).unwrap();
        fs::remove_file(video).unwrap();
        fs::remove_dir(root).unwrap();
    }
    #[test]
    fn denies_ungranted_changed_folders_invalid_content_and_wrong_extensions() {
        let root = fixture("subtitle-export-denied-test");
        let video = root.join("lesson.mp4");
        assert!(write(&video, VTT, |_| Err("FOLDER_NOT_AUTHORIZED".into())).is_err());
        assert!(write(&video, "bad", |_| Ok(())).is_err());
        assert!(write(&root.join("lesson.txt"), VTT, |_| Ok(())).is_err());
        let checks = std::cell::Cell::new(0);
        assert!(
            write(&video, VTT, |_| {
                checks.set(checks.get() + 1);
                if checks.get() > 2 {
                    Err("Folder changed".into())
                } else {
                    Ok(())
                }
            })
            .is_err()
        );
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        fs::remove_dir(root).unwrap();
    }
    #[test]
    fn a_racing_destination_is_kept_and_temporary_output_is_cleaned() {
        let root = fixture("subtitle-export-race-test");
        let video = root.join("lesson.mp4");
        let target = destination(&video).unwrap();
        let checks = std::cell::Cell::new(0);
        assert_eq!(
            write(&video, VTT, |_| {
                checks.set(checks.get() + 1);
                if checks.get() == 3 {
                    fs::write(&target, "someone else's subtitle").unwrap();
                }
                Ok(())
            })
            .unwrap(),
            "existing"
        );
        assert_eq!(
            fs::read_to_string(&target).unwrap(),
            "someone else's subtitle"
        );
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_file(target).unwrap();
        fs::remove_dir(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn existing_symlinks_are_not_followed_or_overwritten() {
        let root = fixture("subtitle-export-link-test");
        let video = root.join("lesson.mp4");
        let outside = root.join("outside.vtt");
        let target = destination(&video).unwrap();
        fs::write(&outside, "original").unwrap();
        std::os::unix::fs::symlink(&outside, &target).unwrap();
        assert_eq!(write(&video, VTT, |_| Ok(())).unwrap(), "existing");
        assert_eq!(fs::read_to_string(&outside).unwrap(), "original");
        fs::remove_file(target).unwrap();
        fs::remove_file(outside).unwrap();
        fs::remove_dir(root).unwrap();
    }
}
