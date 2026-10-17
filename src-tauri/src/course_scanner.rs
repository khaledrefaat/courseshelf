use serde::Serialize;
use std::{fs, path::Path};
use tauri_plugin_fs::FsExt;

#[derive(Debug, Serialize)]
pub struct ScanError {
    code: &'static str,
    message: String,
}

impl ScanError {
    fn new(code: &'static str, message: impl ToString) -> Self {
        Self {
            code,
            message: message.to_string(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct FolderScan {
    root_path: String,
    relative_paths: Vec<String>,
    skipped_symlink_count: usize,
}

fn authorized_root(
    root: &Path,
    allowed: &impl Fn(&Path) -> bool,
) -> Result<std::path::PathBuf, ScanError> {
    if !allowed(root) {
        return Err(ScanError::new(
            "FOLDER_NOT_AUTHORIZED",
            "Folder not authorized; re-pick the course folder.",
        ));
    }
    let canonical =
        fs::canonicalize(root).map_err(|error| ScanError::new("ROOT_UNREADABLE", error))?;
    if !allowed(&canonical) {
        return Err(ScanError::new(
            "FOLDER_NOT_AUTHORIZED",
            "Folder not authorized; re-pick the course folder.",
        ));
    }
    if !fs::metadata(&canonical)
        .map_err(|error| ScanError::new("ROOT_UNREADABLE", error))?
        .is_dir()
    {
        return Err(ScanError::new(
            "ROOT_UNREADABLE",
            "Course root is not a directory",
        ));
    }
    Ok(canonical)
}

#[tauri::command]
pub fn canonicalize_course_root(app: tauri::AppHandle, root: String) -> Result<String, ScanError> {
    let scope = app.fs_scope();
    let canonical = authorized_root(Path::new(&root), &|path| scope.is_allowed(path))?;
    let path = canonical
        .to_str()
        .ok_or_else(|| ScanError::new("SCAN_FAILED", "Non-UTF-8 course root"))?
        .to_owned();
    // Persist the canonical target too, including when the picked root was a symlink.
    scope
        .allow_directory(&canonical, true)
        .map_err(|error| ScanError::new("SCAN_FAILED", error))?;
    Ok(path)
}

#[tauri::command]
pub async fn scan_course_folder(
    app: tauri::AppHandle,
    root: String,
) -> Result<FolderScan, ScanError> {
    let scope = app.fs_scope();
    tauri::async_runtime::spawn_blocking(move || {
        scan(Path::new(&root), &|path| scope.is_allowed(path))
    })
    .await
    .map_err(|error| ScanError::new("SCAN_FAILED", error))?
}

fn scan(root: &Path, allowed: &impl Fn(&Path) -> bool) -> Result<FolderScan, ScanError> {
    let root = authorized_root(root, allowed)?;
    let root_path = root
        .to_str()
        .ok_or_else(|| ScanError::new("SCAN_FAILED", "Non-UTF-8 course root"))?
        .to_owned();
    let mut result = FolderScan {
        root_path,
        relative_paths: Vec::new(),
        skipped_symlink_count: 0,
    };
    let mut pending = vec![root.clone()];
    while let Some(directory) = pending.pop() {
        // Never swallow individual read_dir or file_type errors: a partial scan must not sync.
        let entries = fs::read_dir(&directory).map_err(|error| {
            ScanError::new(
                "ROOT_UNREADABLE",
                format!("{}: {error}", directory.display()),
            )
        })?;
        for entry in entries {
            let entry = entry.map_err(|error| ScanError::new("SCAN_FAILED", error))?;
            let kind = entry
                .file_type()
                .map_err(|error| ScanError::new("SCAN_FAILED", error))?;
            if kind.is_symlink() {
                result.skipped_symlink_count += 1;
                continue;
            }
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| ScanError::new("SCAN_FAILED", "Non-UTF-8 directory entry"))?;
            if kind.is_dir() && name.starts_with('.') {
                continue;
            }
            if !kind.is_file() && !kind.is_dir() {
                continue;
            }
            let path = entry.path();
            // No symlink is intentionally followed; canonical containment also catches substitutions.
            let canonical =
                fs::canonicalize(&path).map_err(|error| ScanError::new("SCAN_FAILED", error))?;
            if !canonical.starts_with(&root) {
                return Err(ScanError::new(
                    "SCAN_FAILED",
                    "Entry resolved outside the course root",
                ));
            }
            if !name.starts_with('.') && !allowed(&canonical) {
                return Err(ScanError::new(
                    "FOLDER_NOT_AUTHORIZED",
                    "Folder entry not authorized; re-pick the course folder.",
                ));
            }
            if kind.is_dir() {
                pending.push(canonical);
            } else {
                let relative = path
                    .strip_prefix(&root)
                    .map_err(|error| ScanError::new("SCAN_FAILED", error))?;
                result.relative_paths.push(
                    relative
                        .to_str()
                        .ok_or_else(|| ScanError::new("SCAN_FAILED", "Non-UTF-8 relative path"))?
                        .replace(std::path::MAIN_SEPARATOR, "/"),
                );
            }
        }
    }
    // A disappeared/unmounted root after traversal must not turn into a successful snapshot.
    let final_root = authorized_root(&root, allowed)?;
    fs::read_dir(final_root).map_err(|error| ScanError::new("ROOT_UNREADABLE", error))?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_ID: AtomicUsize = AtomicUsize::new(0);

    struct Fixture(std::path::PathBuf);

    impl Fixture {
        fn new() -> Self {
            let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(format!(
                "target/course-scanner-tests/{}-{}",
                std::process::id(),
                NEXT_ID.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(fs::canonicalize(path).unwrap())
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn walks_nested_files_and_skips_hidden_directory_trees() {
        let fixture = Fixture::new();
        fs::create_dir_all(fixture.0.join("Section/Nested")).unwrap();
        fs::create_dir_all(fixture.0.join(".hidden")).unwrap();
        for path in [
            "root.mp4",
            "notes.pdf",
            ".DS_Store",
            "Section/Nested/lesson.webm",
            ".hidden/ignored.mp4",
        ] {
            fs::write(fixture.0.join(path), b"test").unwrap();
        }
        let mut result = scan(&fixture.0, &|path| path.starts_with(&fixture.0)).unwrap();
        result.relative_paths.sort();
        assert_eq!(result.root_path, fixture.0.to_str().unwrap());
        assert_eq!(
            result.relative_paths,
            [
                ".DS_Store",
                "Section/Nested/lesson.webm",
                "notes.pdf",
                "root.mp4"
            ]
        );
        assert_eq!(result.skipped_symlink_count, 0);
    }

    #[test]
    fn distinguishes_missing_grants_from_unreadable_roots_and_aborts_on_denied_entries() {
        let fixture = Fixture::new();
        assert_eq!(
            scan(&fixture.0, &|_| false).unwrap_err().code,
            "FOLDER_NOT_AUTHORIZED"
        );
        assert_eq!(
            scan(&fixture.0.join("absent"), &|_| true).unwrap_err().code,
            "ROOT_UNREADABLE"
        );
        fs::write(fixture.0.join("video.mp4"), b"test").unwrap();
        assert_eq!(
            scan(&fixture.0.join("video.mp4"), &|_| true)
                .unwrap_err()
                .code,
            "ROOT_UNREADABLE"
        );
        assert_eq!(
            scan(&fixture.0, &|path| path == fixture.0)
                .unwrap_err()
                .code,
            "FOLDER_NOT_AUTHORIZED"
        );
    }

    #[cfg(unix)]
    #[test]
    fn canonicalizes_the_root_but_never_follows_internal_external_or_loop_symlinks() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        let outside = Fixture::new();
        fs::write(fixture.0.join("real.mp4"), b"test").unwrap();
        fs::write(outside.0.join("outside.mp4"), b"test").unwrap();
        symlink(&fixture.0, outside.0.join("picked-root")).unwrap();
        symlink(fixture.0.join("real.mp4"), fixture.0.join("internal.mp4")).unwrap();
        symlink(&outside.0, fixture.0.join("escape")).unwrap();
        symlink(&fixture.0, fixture.0.join("loop")).unwrap();
        let result = scan(&outside.0.join("picked-root"), &|_| true).unwrap();
        assert_eq!(result.root_path, fixture.0.to_str().unwrap());
        assert_eq!(result.relative_paths, ["real.mp4"]);
        assert_eq!(result.skipped_symlink_count, 3);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_unrepresentable_names_instead_of_returning_a_partial_snapshot() {
        use std::os::unix::ffi::OsStringExt;
        let fixture = Fixture::new();
        fs::write(fixture.0.join("valid.mp4"), b"test").unwrap();
        fs::write(
            fixture.0.join(std::ffi::OsString::from_vec(vec![0xff])),
            b"test",
        )
        .unwrap();
        assert_eq!(scan(&fixture.0, &|_| true).unwrap_err().code, "SCAN_FAILED");
    }
}
