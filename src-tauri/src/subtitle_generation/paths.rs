use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

pub const MODEL: &str = "base.en";
pub const MODEL_HASH: &str = "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002";
pub const MODEL_BYTES: u64 = 147_964_211;
pub const MAX_VTT: u64 = 2 * 1024 * 1024;

pub fn cancelled(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::SeqCst) {
        Err("Cancelled.".into())
    } else {
        Ok(())
    }
}

pub fn directory(root: &Path, name: &str) -> Result<PathBuf, String> {
    fs::create_dir_all(root)
        .map_err(|_| "Could not create app data folder; check disk space and permissions.")?;
    let root = fs::canonicalize(root).map_err(|_| "App data is unavailable.")?;
    let path = root.join(name);
    if !path.exists() {
        fs::create_dir(&path).map_err(|_| "Could not create subtitle cache folder.")?;
    }
    let meta = fs::symlink_metadata(&path).map_err(|_| "Subtitle folder is unavailable.")?;
    if !meta.is_dir()
        || crate::fs_links::is_link(&meta)
        || fs::canonicalize(&path).ok().as_ref() != Some(&path)
    {
        return Err("Subtitle cache folder must not be a link or reparse point.".into());
    }
    Ok(path)
}

pub fn digest_file(path: &Path, cancel: &AtomicBool) -> Result<String, String> {
    let meta = fs::symlink_metadata(path).map_err(|_| "File is missing or unreadable.")?;
    if !meta.is_file() || crate::fs_links::is_link(&meta) {
        return Err("Expected a regular file, not a link.".into());
    }
    let mut file = fs::File::open(path).map_err(|_| "Could not read file.")?;
    let mut sha = Sha256::new();
    let mut buffer = [0; 65_536];
    loop {
        cancelled(cancel)?;
        let count = file.read(&mut buffer).map_err(|_| "Could not read file.")?;
        if count == 0 {
            break;
        }
        sha.update(&buffer[..count]);
    }
    Ok(format!("{:x}", sha.finalize()))
}

pub fn owned_name(lesson_id: i64, name: &str) -> bool {
    lesson_id > 0
        && name
            .strip_prefix(&format!("{lesson_id}-"))
            .and_then(|s| s.strip_suffix(".en.vtt"))
            .is_some_and(|s| {
                s.len() == 64
                    && s.bytes()
                        .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            })
}

pub fn cache_path(root: &Path, lesson_id: i64, name: &str) -> Result<PathBuf, String> {
    if !owned_name(lesson_id, name) {
        return Err("Invalid generated subtitle filename.".into());
    }
    Ok(directory(root, "subtitles")?.join(name))
}

pub fn remove_cache(root: &Path, lesson_id: i64, name: &str) -> Result<(), String> {
    let path = cache_path(root, lesson_id, name)?;
    match fs::symlink_metadata(&path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Ok(meta) if meta.is_file() && !crate::fs_links::is_link(&meta) => {
            fs::remove_file(path).map_err(|_| "Could not remove generated subtitle file.".into())
        }
        _ => Err("Generated subtitle cleanup refused an unsafe path.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cache_names_are_lesson_owned_and_not_paths() {
        let valid = format!("4-{}.en.vtt", "a".repeat(64));
        assert!(owned_name(4, &valid));
        for name in ["../x", "/x", "4-x.en.vtt", "4-..\\x.en.vtt", "4-C:x.en.vtt"] {
            assert!(!owned_name(4, name));
        }
        assert!(!owned_name(5, &valid));
        assert!(!owned_name(0, &valid));
    }
    #[test]
    fn fingerprint_detects_content_changes_and_cancellation_without_hashing_paths() {
        let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/generation-fingerprint-test");
        fs::create_dir_all(&base).unwrap();
        let path = base.join("درس # % +.mp4");
        fs::write(&path, "original").unwrap();
        let original = digest_file(&path, &AtomicBool::new(false)).unwrap();
        fs::write(&path, "changed!").unwrap();
        assert_ne!(
            original,
            digest_file(&path, &AtomicBool::new(false)).unwrap()
        );
        assert!(digest_file(&path, &AtomicBool::new(true)).is_err());
        let moved = base.join("moved.mp4");
        fs::rename(&path, &moved).unwrap();
        let current = digest_file(&moved, &AtomicBool::new(false)).unwrap();
        fs::rename(&moved, &path).unwrap();
        assert_eq!(
            current,
            digest_file(&path, &AtomicBool::new(false)).unwrap()
        );
        fs::remove_file(path).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn cache_directories_cannot_escape_through_symlinks() {
        let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/generation-cache-link-test");
        fs::create_dir_all(base.join("outside")).unwrap();
        std::os::unix::fs::symlink(base.join("outside"), base.join("subtitles")).unwrap();
        assert!(cache_path(&base, 1, &format!("1-{}.en.vtt", "a".repeat(64))).is_err());
        fs::remove_file(base.join("subtitles")).unwrap();
        fs::remove_dir(base.join("outside")).unwrap();
    }
}
