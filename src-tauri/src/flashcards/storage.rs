//! Private, bounded checkpoints. Only known lesson-owned names are ever touched.
use super::{Checkpoint, Reply};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

pub const MAX_REPLY: u64 = 1024 * 1024;
const MAX_MANIFEST: u64 = 65_536;

pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn random_id() -> Result<String, String> {
    let mut bytes = [0; 32];
    getrandom::fill(&mut bytes).map_err(|_| "Secure randomness unavailable.")?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn directory(parent: &Path, name: &str) -> Result<PathBuf, String> {
    fs::create_dir_all(parent).map_err(|_| "Could not access app data.")?;
    let parent = fs::canonicalize(parent).map_err(|_| "App data is unavailable.")?;
    let path = parent.join(name);
    if !path.exists() {
        let builder = fs::DirBuilder::new();
        #[cfg(unix)]
        let mut builder = builder;
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder
            .create(&path)
            .map_err(|_| "Could not create flashcard checkpoint folder.")?;
    }
    let meta = fs::symlink_metadata(&path).map_err(|_| "Checkpoint folder is unavailable.")?;
    if !meta.is_dir()
        || crate::fs_links::is_link(&meta)
        || fs::canonicalize(&path).ok().as_ref() != Some(&path)
    {
        return Err("Checkpoint folder must not be a link or reparse point.".into());
    }
    Ok(path)
}

pub fn lesson_dir(root: &Path, course: i64, lesson: i64) -> Result<PathBuf, String> {
    if course <= 0 || lesson <= 0 {
        return Err("Invalid flashcard lesson.".into());
    }
    directory(
        &directory(root, "flashcard-jobs")?,
        &format!("{course}-{lesson}"),
    )
}

// At most two bounded retry slots. Root responses remain untouched until a
// successful publication or an explicit discard. The pointer publishes LAST.
pub fn active_dir(base: &Path) -> Result<PathBuf, String> {
    let pointer = base.join("active.json");
    match fs::symlink_metadata(&pointer) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(base.to_path_buf()),
        Err(_) => return Err("Could not inspect recovery pointer.".into()),
    }
    let slot: String =
        serde_json::from_slice(&read(&pointer, 128)?).map_err(|_| "Invalid recovery pointer.")?;
    if !matches!(slot.as_str(), "retry-a" | "retry-b") {
        return Err("Invalid recovery slot.".into());
    }
    let path = base.join(&slot);
    let meta = fs::symlink_metadata(&path).map_err(|_| "Recovery slot is missing.")?;
    if !meta.is_dir()
        || crate::fs_links::is_link(&meta)
        || fs::canonicalize(&path).ok().as_ref() != Some(&path)
    {
        return Err("Unsafe recovery slot.".into());
    }
    Ok(path)
}

pub fn recover(
    base: &Path,
    expected: &Checkpoint,
    keep: usize,
) -> Result<(PathBuf, Checkpoint), String> {
    let active = active_dir(base)?;
    let original = load(&active)?.ok_or("No checkpoint to recover.")?;
    if !original.resumable()
        || keep >= original.requests.len()
        || serde_json::to_vec(&original).ok() != serde_json::to_vec(expected).ok()
    {
        return Err(
            "Checkpoint changed or has an uncertain request. Preview again; nothing sent.".into(),
        );
    }
    let replies = replies(&active, &original)?;
    let slot = if active.file_name().is_some_and(|name| name == "retry-a") {
        "retry-b"
    } else {
        "retry-a"
    };
    let target = directory(base, slot)?;
    clear_files(&target)?;
    let mut checkpoint = original;
    checkpoint.id = random_id()?;
    checkpoint.requests.truncate(keep);
    for (index, reply) in replies.iter().take(keep).enumerate() {
        checkpoint.requests[index].hash = Some(save_reply(&target, index, reply)?);
    }
    save(&target, &checkpoint)?;
    write(
        &base.join("active.json"),
        &serde_json::to_vec(slot).map_err(|_| "Could not encode recovery pointer.")?,
        true,
    )?;
    Ok((target, checkpoint))
}

fn regular(path: &Path, limit: u64) -> Result<(), String> {
    let meta =
        fs::symlink_metadata(path).map_err(|_| "Checkpoint file is missing or unreadable.")?;
    if !meta.is_file()
        || crate::fs_links::is_link(&meta)
        || meta.len() > limit
        || fs::canonicalize(path).ok().as_deref() != Some(path)
    {
        return Err("Unsafe or oversized flashcard checkpoint file.".into());
    }
    Ok(())
}

fn read(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    regular(path, limit)?;
    let file = fs::File::open(path).map_err(|_| "Could not open flashcard checkpoint.")?;
    let opened = file
        .metadata()
        .map_err(|_| "Could not inspect checkpoint.")?;
    regular(path, limit)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let now = fs::symlink_metadata(path).map_err(|_| "Checkpoint changed.")?;
        if opened.dev() != now.dev() || opened.ino() != now.ino() {
            return Err("Checkpoint changed while opening.".into());
        }
    }
    if !opened.is_file() {
        return Err("Invalid checkpoint file.".into());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read checkpoint.")?;
    if bytes.len() as u64 > limit {
        return Err("Checkpoint exceeds its size limit.".into());
    }
    regular(path, limit)?;
    Ok(bytes)
}

fn write(path: &Path, bytes: &[u8], replace: bool) -> Result<(), String> {
    if path.exists() {
        regular(path, MAX_REPLY)?;
        if !replace {
            return Err("Checkpoint response already exists.".into());
        }
    }
    let temporary = path.with_file_name(format!("tmp-{}", random_id()?));
    let result = (|| {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temporary)
            .map_err(|_| "Could not create checkpoint staging file.")?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "Could not sync checkpoint; check disk space.")?;
        if replace {
            if path.exists() {
                regular(path, MAX_MANIFEST)?;
            }
            fs::rename(&temporary, path).map_err(|_| "Could not publish checkpoint manifest.")?;
        } else {
            fs::hard_link(&temporary, path).map_err(|_| "Could not publish checkpoint without overwriting. App data needs hard-link support.")?;
            fs::remove_file(&temporary)
                .map_err(|_| "Checkpoint saved but staging cleanup failed.")?;
        }
        Ok(())
    })();
    if temporary.exists() {
        let _ = fs::remove_file(temporary);
    }
    result
}

pub fn save(dir: &Path, checkpoint: &Checkpoint) -> Result<(), String> {
    let bytes = serde_json::to_vec(checkpoint).map_err(|_| "Could not encode checkpoint.")?;
    if bytes.len() as u64 > MAX_MANIFEST {
        return Err("Checkpoint metadata is too large.".into());
    }
    write(&dir.join("manifest.json"), &bytes, true)
}

pub fn load(dir: &Path) -> Result<Option<Checkpoint>, String> {
    let path = dir.join("manifest.json");
    if !path
        .try_exists()
        .map_err(|_| "Could not inspect checkpoint.")?
    {
        return Ok(None);
    }
    let checkpoint: Checkpoint = serde_json::from_slice(&read(&path, MAX_MANIFEST)?)
        .map_err(|_| "Invalid flashcard checkpoint metadata. Discard it to start again.")?;
    checkpoint.validate()?;
    Ok(Some(checkpoint))
}

pub fn save_reply(dir: &Path, index: usize, reply: &Reply) -> Result<String, String> {
    if index >= 9 {
        return Err("Too many flashcard requests.".into());
    }
    let bytes = serde_json::to_vec(reply).map_err(|_| "Could not encode flashcards.")?;
    if bytes.len() as u64 > MAX_REPLY {
        return Err("Flashcard response exceeds its checkpoint limit.".into());
    }
    write(&dir.join(format!("response-{index}.json")), &bytes, false)?;
    Ok(hash(&bytes))
}

pub fn replies(dir: &Path, checkpoint: &Checkpoint) -> Result<Vec<Reply>, String> {
    checkpoint
        .requests
        .iter()
        .enumerate()
        .filter(|(_, request)| request.status == "received")
        .map(|(index, request)| {
            let bytes = read(&dir.join(format!("response-{index}.json")), MAX_REPLY)?;
            if request.hash.as_ref() != Some(&hash(&bytes)) {
                return Err("Checkpoint response fingerprint differs.".into());
            }
            serde_json::from_slice(&bytes).map_err(|_| "Invalid checkpoint response.".into())
        })
        .collect()
}

fn owned_file(name: &str) -> bool {
    name == "manifest.json"
        || (0..9).any(|i| name == format!("response-{i}.json"))
        || name.strip_prefix("tmp-").is_some_and(super::valid_id)
}

fn clear_files(dir: &Path) -> Result<(), String> {
    // Inspect everything before deleting anything. Never recurse into unknown content.
    let entries: Vec<_> = fs::read_dir(dir)
        .map_err(|_| "Could not inspect checkpoint cleanup.")?
        .map(|entry| entry.map_err(|_| "Could not inspect checkpoint entry.".to_owned()))
        .collect::<Result<_, _>>()?;
    for entry in &entries {
        if !entry.file_name().to_str().is_some_and(owned_file) {
            return Err("Unknown checkpoint content was left untouched.".into());
        }
        regular(&entry.path(), MAX_REPLY)?;
    }
    for entry in entries {
        fs::remove_file(entry.path()).map_err(|_| "Could not remove owned checkpoint file.")?;
    }
    Ok(())
}

pub fn clear(dir: &Path) -> Result<(), String> {
    // Validate all content, including BOTH slots, before removing any file.
    let entries = fs::read_dir(dir)
        .map_err(|_| "Could not inspect checkpoint cleanup.")?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Could not inspect checkpoint cleanup.")?;
    let mut slots = Vec::new();
    for entry in &entries {
        let name = entry.file_name();
        if matches!(name.to_str(), Some("retry-a" | "retry-b")) {
            let path = entry.path();
            let meta =
                fs::symlink_metadata(&path).map_err(|_| "Could not inspect recovery slot.")?;
            if !meta.is_dir()
                || crate::fs_links::is_link(&meta)
                || fs::canonicalize(&path).ok().as_ref() != Some(&path)
            {
                return Err("Unsafe recovery slot left untouched.".into());
            }
            for child in fs::read_dir(&path).map_err(|_| "Could not inspect recovery slot.")? {
                let child = child.map_err(|_| "Could not inspect recovery file.")?;
                if !child.file_name().to_str().is_some_and(owned_file) {
                    return Err("Unknown recovery content was left untouched.".into());
                }
                regular(&child.path(), MAX_REPLY)?;
            }
            slots.push(path);
        } else {
            if name != "active.json" && !name.to_str().is_some_and(owned_file) {
                return Err("Unknown checkpoint content was left untouched.".into());
            }
            regular(&entry.path(), MAX_REPLY)?;
        }
    }
    for slot in slots {
        clear_files(&slot)?;
        fs::remove_dir(slot).map_err(|_| "Could not remove recovery slot.")?;
    }
    for entry in entries {
        if !matches!(
            entry.file_name().to_str(),
            Some("active.json" | "retry-a" | "retry-b")
        ) {
            fs::remove_file(entry.path()).map_err(|_| "Could not remove checkpoint file.")?;
        }
    }
    let pointer = dir.join("active.json");
    if pointer
        .try_exists()
        .map_err(|_| "Could not inspect recovery pointer.")?
    {
        fs::remove_file(pointer).map_err(|_| "Could not remove recovery pointer.")?;
    }
    Ok(())
}

pub fn clean_course(root: &Path, course: i64) -> Result<(), String> {
    let base = directory(root, "flashcard-jobs")?;
    for entry in fs::read_dir(&base).map_err(|_| "Could not inspect flashcard checkpoints.")? {
        let entry = entry.map_err(|_| "Could not inspect checkpoint entry.")?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        let Some(suffix) = name.strip_prefix(&format!("{course}-")) else {
            continue;
        };
        let Ok(lesson) = suffix.parse::<i64>() else {
            continue;
        };
        if lesson <= 0 || suffix != lesson.to_string() {
            continue;
        }
        let dir = lesson_dir(root, course, lesson)?;
        clear(&dir)?;
        fs::remove_dir(dir).map_err(|_| "Could not remove empty checkpoint folder.")?;
    }
    Ok(())
}
