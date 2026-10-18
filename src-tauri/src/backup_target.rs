use std::{
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
};
use tauri::Manager;
use tauri_plugin_fs::FsExt;

// Read-only preflight and postflight; only the SQL plugin writes the backup.
fn validate(
    path: &Path,
    roots: &[PathBuf],
    app_dirs: &[PathBuf],
    verify: bool,
    allowed: impl Fn(&Path) -> bool,
) -> Result<String, String> {
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
    {
        return Err("Choose an absolute local path without traversal.".into());
    }
    if !allowed(path) {
        return Err("Choose the backup destination with the save dialog.".into());
    }
    let parent = fs::canonicalize(path.parent().ok_or("Invalid backup destination")?)
        .map_err(|e| format!("Cannot access destination folder: {e}"))?;
    let target = parent.join(path.file_name().ok_or("Invalid backup file name")?);
    for root in roots.iter().chain(app_dirs) {
        let canonical = match fs::canonicalize(root) {
            Ok(value) => value,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => root.clone(),
            Err(e) => return Err(format!("Cannot verify protected folder: {e}")),
        };
        if target.starts_with(canonical) {
            return Err(
                "Save the backup outside course folders and the app's live-data folders.".into(),
            );
        }
    }
    match fs::symlink_metadata(&target) {
        Ok(info) => {
            if !verify {
                return Err("That file already exists. Choose a new file name; backups are never overwritten.".into());
            }
            if !info.is_file() || info.file_type().is_symlink() || info.len() < 100 {
                return Err("Backup is missing, empty, or invalid.".into());
            }
            let mut header = [0; 16];
            fs::File::open(&target)
                .and_then(|mut file| file.read_exact(&mut header))
                .map_err(|e| format!("Cannot verify backup: {e}"))?;
            if &header != b"SQLite format 3\0" {
                return Err("Backup does not have a SQLite database header.".into());
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound && !verify => {}
        Err(e) => return Err(format!("Cannot verify backup destination: {e}")),
    }
    target
        .to_str()
        .map(str::to_owned)
        .ok_or_else(|| "Backup path is not valid Unicode.".into())
}

#[tauri::command]
pub fn validate_backup_target(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::video_stream::VideoStream>,
    path: String,
    course_roots: Vec<String>,
    verify: bool,
) -> Result<String, String> {
    let mut roots = state
        .registered_paths()
        .map_err(|_| "Root registry unavailable")?;
    roots.extend(course_roots.into_iter().map(PathBuf::from));
    let dirs = [
        app.path().app_data_dir().map_err(|e| e.to_string())?,
        app.path().app_config_dir().map_err(|e| e.to_string())?,
    ];
    validate(Path::new(&path), &roots, &dirs, verify, |path| {
        app.fs_scope().is_allowed(path)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_new_targets_and_rejects_existing_empty_files_traversal_grant_failures_and_protected_aliases()
     {
        let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/backup-target-tests");
        fs::create_dir_all(base.join("course")).unwrap();
        let base = fs::canonicalize(base).unwrap();
        let root = base.join("course");
        let candidate = base.join("fresh.db");
        assert!(
            validate(&candidate, std::slice::from_ref(&root), &[], false, |_| {
                true
            })
            .is_ok()
        );
        assert!(validate(&candidate, &[], &[], false, |_| false).is_err());
        assert!(validate(Path::new("file:bad.db"), &[], &[], false, |_| true).is_err());
        // Windows canonicalize() returns a verbatim path. PathBuf::join() on
        // that prefix removes '..' before validate() can inspect it, so append
        // raw text with native separators to preserve the malicious input.
        let mut traversal = base.as_os_str().to_os_string();
        let separator = std::path::MAIN_SEPARATOR;
        traversal.push(format!("{separator}course{separator}..{separator}bad.db"));
        let traversal = PathBuf::from(traversal);
        assert!(
            traversal
                .components()
                .any(|part| matches!(part, Component::ParentDir)),
            "Traversal fixture must retain its parent component"
        );
        assert!(validate(&traversal, &[], &[], false, |_| true).is_err());
        assert!(
            validate(
                &root.join("bad.db"),
                std::slice::from_ref(&root),
                &[],
                false,
                |_| true
            )
            .is_err()
        );
        let empty = base.join("empty.db");
        fs::write(&empty, []).unwrap();
        assert!(validate(&empty, &[], &[], false, |_| true).is_err());
        assert!(validate(&empty, &[], &[], true, |_| true).is_err());
        #[cfg(unix)]
        {
            let alias = base.join("alias");
            if !alias.exists() {
                std::os::unix::fs::symlink(&root, &alias).unwrap();
            }
            assert!(validate(&alias.join("bad.db"), &[root], &[], false, |_| true).is_err());
        }
        fs::remove_file(empty).unwrap();
    }
}
