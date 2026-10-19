use super::{
    Job,
    download::{self, Download},
    paths::*,
};
use std::{
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, atomic::AtomicBool},
};

#[derive(Clone, Copy)]
struct Release {
    stem: &'static str,
    archive: &'static str,
    bytes: u64,
    sha256: &'static str,
    binary: &'static str,
    binary_bytes: u64,
    binary_sha256: &'static str,
    folder: &'static str,
    zip: bool,
}
const LINUX: Release = Release {
    stem: "ffmpeg-n8.1.3-18-g46d899d7a0-linux64-lgpl-8.1",
    archive: "ffmpeg-n8.1.3-18-g46d899d7a0-linux64-lgpl-8.1.tar.xz",
    bytes: 137_053_196,
    sha256: "746a270f8f6bdaca09a5caee3a9303e2e42cd4006891541f629179d162927516",
    binary: "ffmpeg",
    binary_bytes: 142_260_744,
    binary_sha256: "001286fc70e397509ee6d2b0d3b08fd26562e132b115deb1c689a73a0e3beeca",
    folder: "ffmpeg-8.1.3-46d899d7a0-linux-x64",
    zip: false,
};
const WINDOWS: Release = Release {
    stem: "ffmpeg-n8.1.3-18-g46d899d7a0-win64-lgpl-8.1",
    archive: "ffmpeg-n8.1.3-18-g46d899d7a0-win64-lgpl-8.1.zip",
    bytes: 170_543_316,
    sha256: "0bfeae2d03bce73d58ab5c7ff8cb0f50cba524091fd47a9ba6f3504e7dd5eafa",
    binary: "ffmpeg.exe",
    binary_bytes: 134_092_288,
    binary_sha256: "d99608a9f2662003104c921ce23e7aa857b3a9bcac368b936e4fb01dcf2110b7",
    folder: "ffmpeg-8.1.3-46d899d7a0-windows-x64",
    zip: true,
};
fn release() -> Release {
    if cfg!(windows) { WINDOWS } else { LINUX }
}
pub fn download_bytes() -> u64 {
    release().bytes
}

fn safe_folder(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "FFmpeg folder is unavailable.")?;
    if !metadata.is_dir()
        || crate::fs_links::is_link(&metadata)
        || fs::canonicalize(path).ok().as_deref() != Some(path)
    {
        return Err("FFmpeg folder must not be a link or reparse point.".into());
    }
    Ok(())
}
fn installed(root: &Path, spec: Release) -> Result<Option<PathBuf>, String> {
    let tools = directory(root, "tools")?;
    let folder = tools.join(spec.folder);
    match fs::symlink_metadata(&folder) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("FFmpeg folder is unreadable.".into()),
        Ok(_) => safe_folder(&folder)?,
    }
    for (name, expected_size) in [
        (spec.binary, Some(spec.binary_bytes)),
        ("LICENSE.txt", None),
        ("BUILD-SOURCES.txt", None),
    ] {
        let path = folder.join(name);
        let Ok(info) = fs::symlink_metadata(&path) else {
            return Ok(None);
        };
        if !info.is_file()
            || crate::fs_links::is_link(&info)
            || fs::canonicalize(&path).ok().as_ref() != Some(&path)
        {
            return Err("FFmpeg cache contains unsafe files.".into());
        }
        if expected_size.is_some_and(|size| info.len() != size) || info.len() == 0 {
            return Ok(None);
        }
    }
    Ok(Some(folder.join(spec.binary)))
}
pub fn present(root: &Path) -> bool {
    installed(root, release()).ok().flatten().is_some()
}

struct CheckedReader<'a, R> {
    inner: R,
    cancel: &'a AtomicBool,
    remaining: u64,
}
impl<R: Read> Read for CheckedReader<'_, R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if buffer.is_empty() {
            return Ok(0);
        }
        if self.cancel.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(io::Error::other("Cancelled"));
        }
        if self.remaining == 0 {
            return Err(io::Error::other("FFmpeg extraction exceeds its limit"));
        }
        let len = buffer.len().min(self.remaining as usize);
        let count = self.inner.read(&mut buffer[..len])?;
        self.remaining -= count as u64;
        Ok(count)
    }
}

fn selected_name(spec: Release, name: &str) -> Result<Option<&'static str>, String> {
    if name.starts_with('/')
        || name.contains(['\\', ':'])
        || name.split('/').any(|part| matches!(part, "." | ".."))
    {
        return Err("Unsafe path in FFmpeg archive.".into());
    }
    let name = name.trim_end_matches('/');
    if name != spec.stem && !name.starts_with(&format!("{}/", spec.stem)) {
        return Err("Unexpected FFmpeg archive root.".into());
    }
    if name == format!("{}/bin/{}", spec.stem, spec.binary) {
        Ok(Some(spec.binary))
    } else if name == format!("{}/LICENSE.txt", spec.stem) {
        Ok(Some("LICENSE.txt"))
    } else {
        Ok(None)
    }
}
fn copy_entry(
    spec: Release,
    name: &str,
    size: u64,
    mut reader: impl Read,
    stage: &Path,
    job: &Arc<Job>,
) -> Result<(), String> {
    let limit = if name == spec.binary {
        spec.binary_bytes
    } else {
        65_536
    };
    if size == 0 || size > limit || (name == spec.binary && size != limit) {
        return Err("FFmpeg archive entry has an unexpected size.".into());
    }
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(stage.join(name))
        .map_err(|_| "Duplicate or unwritable FFmpeg archive entry.")?;
    let mut buffer = [0_u8; 65_536];
    let mut written = 0_u64;
    loop {
        cancelled(&job.cancel)?;
        let count = reader
            .read(&mut buffer)
            .map_err(|_| "Could not read FFmpeg archive entry.")?;
        if count == 0 {
            break;
        }
        written += count as u64;
        if written > limit {
            return Err("FFmpeg archive entry exceeded its limit.".into());
        }
        output
            .write_all(&buffer[..count])
            .map_err(|_| "Could not extract FFmpeg. Check disk space.")?;
    }
    if written != size {
        return Err("FFmpeg archive entry was truncated.".into());
    }
    output
        .sync_all()
        .map_err(|_| "Could not finish extracting FFmpeg.".to_string())
}
fn unpack(spec: Release, archive: &Path, stage: &Path, job: &Arc<Job>) -> Result<(), String> {
    job.stage("Extracting FFmpeg", None);
    let file = fs::File::open(archive).map_err(|_| "FFmpeg archive is unavailable.")?;
    if spec.zip {
        let mut zip = zip::ZipArchive::new(file).map_err(|_| "Invalid FFmpeg ZIP archive.")?;
        if zip.len() > 512
            || zip
                .decompressed_size()
                .is_none_or(|size| size > 512 * 1024 * 1024)
        {
            return Err("FFmpeg ZIP exceeds extraction limits.".into());
        }
        for index in 0..zip.len() {
            cancelled(&job.cancel)?;
            let entry = zip
                .by_index(index)
                .map_err(|_| "Could not read FFmpeg ZIP entry.")?;
            let name = entry
                .name()
                .map_err(|_| "Invalid FFmpeg ZIP filename.")?
                .into_owned();
            let selected = selected_name(spec, &name)?;
            let kind = entry.unix_mode().unwrap_or(0) & 0o170000;
            if !matches!(kind, 0 | 0o100000 | 0o040000) {
                return Err("Links/devices are not allowed in FFmpeg archives.".into());
            }
            if let Some(output) = selected {
                if entry.is_dir() {
                    return Err("Expected a regular FFmpeg archive file.".into());
                }
                copy_entry(spec, output, entry.size(), entry, stage, job)?;
            }
        }
    } else {
        let reader = lzma_rust2::XzReader::new_mem_limit(file, false, 256 * 1024);
        let reader = CheckedReader {
            inner: reader,
            cancel: &job.cancel,
            remaining: 512 * 1024 * 1024,
        };
        let mut archive = tar::Archive::new(reader);
        for (index, entry) in archive
            .entries()
            .map_err(|_| "Invalid FFmpeg TAR archive.")?
            .enumerate()
        {
            cancelled(&job.cancel)?;
            if index >= 512 {
                return Err("Too many entries in FFmpeg archive.".into());
            }
            let entry = entry.map_err(|_| "Could not read FFmpeg TAR entry.")?;
            let path = entry.path().map_err(|_| "Invalid FFmpeg TAR filename.")?;
            let name = path.to_str().ok_or("Invalid FFmpeg TAR filename.")?;
            let selected = selected_name(spec, name)?;
            let kind = entry.header().entry_type();
            if !kind.is_file() && !kind.is_dir() {
                return Err("Links/devices are not allowed in FFmpeg archives.".into());
            }
            if let Some(output) = selected {
                if !kind.is_file() {
                    return Err("Expected a regular FFmpeg archive file.".into());
                }
                let size = entry.size();
                copy_entry(spec, output, size, entry, stage, job)?;
            }
        }
    }
    if digest_file(&stage.join(spec.binary), &job.cancel)? != spec.binary_sha256 {
        return Err("Extracted FFmpeg checksum verification failed.".into());
    }
    if !fs::metadata(stage.join("LICENSE.txt")).is_ok_and(|m| m.len() > 0 && m.len() <= 65_536) {
        return Err("FFmpeg license file is missing.".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(stage.join(spec.binary), fs::Permissions::from_mode(0o755))
            .map_err(|_| "Could not make FFmpeg executable.")?;
    }
    fs::write(stage.join("BUILD-SOURCES.txt"), "FFmpeg LGPL build: https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-10-18-13-01\nSource/build recipes: https://github.com/BtbN/FFmpeg-Builds\nFFmpeg source: https://github.com/FFmpeg/FFmpeg/tree/46d899d7a0\nDownloaded directly from upstream; preserve LICENSE.txt and review redistribution obligations before sharing.\n")
        .map_err(|_| "Could not save FFmpeg source notices.")?;
    cancelled(&job.cancel)
}

fn install(root: &Path, stage: &Path, spec: Release, job: &Arc<Job>) -> Result<PathBuf, String> {
    cancelled(&job.cancel)?;
    let tools = directory(root, "tools")?;
    safe_folder(stage)?;
    let destination = tools.join(spec.folder);
    if fs::symlink_metadata(&destination).is_ok() {
        safe_folder(&destination)?;
        // Preserve an invalid older cache rather than deleting unknown user files.
        fs::rename(
            &destination,
            tools.join(format!("ffmpeg-invalid-{}", job.id)),
        )
        .map_err(|_| "Could not preserve the invalid FFmpeg cache before repair.")?;
    }
    fs::rename(stage, &destination).map_err(|_| "Could not install verified FFmpeg.")?;
    Ok(destination.join(spec.binary))
}
pub fn ensure(root: &Path, job: &Arc<Job>, consent: bool) -> Result<PathBuf, String> {
    ensure_release(root, job, consent, release())
}
fn ensure_release(
    root: &Path,
    job: &Arc<Job>,
    consent: bool,
    spec: Release,
) -> Result<PathBuf, String> {
    job.stage("Checking FFmpeg", None);
    if let Some(path) = installed(root, spec)?
        && digest_file(&path, &job.cancel)? == spec.binary_sha256
    {
        return Ok(path);
    }
    if !consent {
        return Err("FFmpeg is missing or invalid. Confirm its download to continue.".into());
    }
    let tools = directory(root, "tools")?;
    let stage = directory(&tools, &format!("ffmpeg-staging-{}", job.id))?;
    let result = (|| {
        let archive = stage.join("archive.part");
        let url = format!(
            "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-18-13-01/{}",
            spec.archive
        );
        download::fetch(
            &Download {
                url: &url,
                bytes: spec.bytes,
                sha256: spec.sha256,
            },
            &archive,
            job,
        )?;
        unpack(spec, &archive, &stage, job)?;
        fs::remove_file(archive).map_err(|_| "Could not clean FFmpeg download archive.")?;
        install(root, &stage, spec, job)
    })();
    if let Err(mut message) = result {
        if fs::remove_dir_all(&stage).is_err() {
            message.push_str(" Temporary FFmpeg cleanup also failed; restart to retry cleanup.");
        }
        return Err(message);
    }
    result
}

pub fn clean_interrupted(root: &Path) -> Result<(), String> {
    let tools = directory(root, "tools")?;
    for entry in fs::read_dir(&tools).map_err(|_| "Could not read FFmpeg tool cache.")? {
        let entry = entry.map_err(|_| "Could not read FFmpeg tool cache entry.")?;
        let name = entry.file_name();
        let Some(id) = name
            .to_str()
            .and_then(|s| s.strip_prefix("ffmpeg-staging-"))
        else {
            continue;
        };
        if id.len() != 64
            || !id
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        {
            continue;
        }
        let path = entry.path();
        safe_folder(&path)?;
        fs::remove_dir_all(path).map_err(|_| "Could not clean interrupted FFmpeg download.")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use zip::write::SimpleFileOptions;

    const FIXTURE: Release = Release {
        binary_bytes: 4,
        binary_sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
        ..WINDOWS
    };
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let root = Path::new(env!("CARGO_MANIFEST_DIR")).join(format!(
                "target/ffmpeg-download-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&root).unwrap();
            Self(fs::canonicalize(root).unwrap())
        }
        fn stage(&self) -> PathBuf {
            directory(
                &directory(&self.0, "tools").unwrap(),
                &format!("ffmpeg-staging-{}", "a".repeat(64)),
            )
            .unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }
    fn archive(root: &Path, entries: &[(&str, &[u8])]) -> PathBuf {
        let path = root.join("fixture.zip");
        let mut zip = zip::ZipWriter::new(fs::File::create(&path).unwrap());
        for (name, bytes) in entries {
            zip.start_file(*name, SimpleFileOptions::default()).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
        path
    }
    #[test]
    fn archive_paths_are_exact_and_never_used_as_output_paths() {
        for spec in [LINUX, WINDOWS] {
            assert_eq!(
                selected_name(spec, &format!("{}/bin/{}", spec.stem, spec.binary)).unwrap(),
                Some(spec.binary)
            );
            assert_eq!(
                selected_name(spec, &format!("{}/doc/readme", spec.stem)).unwrap(),
                None
            );
            for name in ["../ffmpeg", "/ffmpeg", "C:/ffmpeg", "wrong/bin/ffmpeg"] {
                assert!(selected_name(spec, name).is_err());
            }
            for suffix in ["/../outside", "/./file", "/bin/ffmpeg:ads", "\\bin\\ffmpeg"] {
                assert!(selected_name(spec, &format!("{}{suffix}", spec.stem)).is_err());
            }
        }
    }
    #[test]
    fn extracts_only_binary_license_and_notices_then_reuses_verified_cache_offline() {
        let fixture = Fixture::new();
        let job = super::super::fixture_job();
        let stage = fixture.stage();
        let binary = format!("{}/bin/{}", FIXTURE.stem, FIXTURE.binary);
        let license = format!("{}/LICENSE.txt", FIXTURE.stem);
        let ignored = format!("{}/bin/ffplay.exe", FIXTURE.stem);
        let zip = archive(
            &fixture.0,
            &[
                (&binary, b"test"),
                (&license, b"license"),
                (&ignored, b"ignored"),
            ],
        );
        assert!(installed(&fixture.0, FIXTURE).unwrap().is_none());
        unpack(FIXTURE, &zip, &stage, &job).unwrap();
        assert_eq!(fs::read_dir(&stage).unwrap().count(), 3);
        let path = install(&fixture.0, &stage, FIXTURE, &job).unwrap();
        assert_eq!(
            ensure_release(&fixture.0, &job, false, FIXTURE).unwrap(),
            path
        );
        fs::write(&path, b"fake").unwrap();
        assert!(
            ensure_release(&fixture.0, &job, false, FIXTURE)
                .unwrap_err()
                .contains("Confirm")
        );
        let repaired_stage = fixture.stage();
        unpack(FIXTURE, &zip, &repaired_stage, &job).unwrap();
        assert_eq!(
            install(&fixture.0, &repaired_stage, FIXTURE, &job).unwrap(),
            path
        );
        let preserved = fixture
            .0
            .join("tools")
            .join(format!("ffmpeg-invalid-{}", job.id));
        assert_eq!(fs::read(preserved.join(FIXTURE.binary)).unwrap(), b"fake");
        assert_eq!(
            ensure_release(&fixture.0, &job, false, FIXTURE).unwrap(),
            path
        );
        fs::write(&path, b"x").unwrap();
        assert!(installed(&fixture.0, FIXTURE).unwrap().is_none());
        job.kill();
        assert!(ensure_release(&fixture.0, &job, true, FIXTURE).is_err());
    }
    #[test]
    fn rejects_bad_checksum_missing_license_traversal_and_partial_archives() {
        let binary = format!("{}/bin/{}", FIXTURE.stem, FIXTURE.binary);
        let license = format!("{}/LICENSE.txt", FIXTURE.stem);
        for entries in [
            vec![
                (binary.as_str(), b"fake".as_slice()),
                (license.as_str(), b"license"),
            ],
            vec![(binary.as_str(), b"test".as_slice())],
            vec![
                (binary.as_str(), b"tes".as_slice()),
                (license.as_str(), b"license"),
            ],
            vec![("../outside", b"test".as_slice())],
        ] {
            let fixture = Fixture::new();
            let stage = fixture.stage();
            let zip = archive(&fixture.0, &entries);
            assert!(unpack(FIXTURE, &zip, &stage, &super::super::fixture_job()).is_err());
            assert!(installed(&fixture.0, FIXTURE).unwrap().is_none());
        }
        let fixture = Fixture::new();
        let zip = fixture.0.join("bad.zip");
        fs::write(&zip, "not an archive").unwrap();
        assert!(
            unpack(
                FIXTURE,
                &zip,
                &fixture.stage(),
                &super::super::fixture_job()
            )
            .is_err()
        );
    }
    #[test]
    fn rejects_archive_symlinks_even_for_ignored_entries_and_oversized_licenses() {
        let fixture = Fixture::new();
        let zip = fixture.0.join("link.zip");
        let mut writer = zip::ZipWriter::new(fs::File::create(&zip).unwrap());
        writer
            .add_symlink(
                format!("{}/doc/link", FIXTURE.stem),
                "../../outside",
                SimpleFileOptions::default(),
            )
            .unwrap();
        writer.finish().unwrap();
        let job = super::super::fixture_job();
        assert!(
            unpack(FIXTURE, &zip, &fixture.stage(), &job)
                .unwrap_err()
                .contains("Links")
        );
        assert!(
            copy_entry(
                FIXTURE,
                "LICENSE.txt",
                65_537,
                &b""[..],
                &fixture.stage(),
                &job
            )
            .is_err()
        );
        assert!(
            copy_entry(
                FIXTURE,
                FIXTURE.binary,
                4,
                &b"too long"[..],
                &fixture.stage(),
                &job
            )
            .is_err()
        );
    }
    #[test]
    fn cancellation_limits_and_cleanup_preserve_unrelated_files() {
        let fixture = Fixture::new();
        let stage = fixture.stage();
        fs::write(stage.join("partial"), "partial").unwrap();
        let tools = directory(&fixture.0, "tools").unwrap();
        fs::create_dir(tools.join("ffmpeg-staging-user-data")).unwrap();
        fs::create_dir(tools.join("ffmpeg-invalid-preserved")).unwrap();
        let job = super::super::fixture_job();
        job.kill();
        assert!(install(&fixture.0, &stage, FIXTURE, &job).is_err());
        let mut reader = CheckedReader {
            inner: &b"12345"[..],
            cancel: &job.cancel,
            remaining: 3,
        };
        assert!(reader.read(&mut [0; 1]).is_err());
        let cancel = AtomicBool::new(false);
        let mut reader = CheckedReader {
            inner: &b"12345"[..],
            cancel: &cancel,
            remaining: 3,
        };
        assert_eq!(reader.read(&mut [0; 10]).unwrap(), 3);
        assert!(reader.read(&mut [0; 1]).is_err());
        clean_interrupted(&fixture.0).unwrap();
        assert!(!stage.exists());
        assert!(tools.join("ffmpeg-staging-user-data").exists());
        assert!(tools.join("ffmpeg-invalid-preserved").exists());
    }
    #[cfg(unix)]
    #[test]
    fn rejects_linked_cache_folders() {
        let fixture = Fixture::new();
        let tools = directory(&fixture.0, "tools").unwrap();
        std::os::unix::fs::symlink(&fixture.0, tools.join(FIXTURE.folder)).unwrap();
        assert!(installed(&fixture.0, FIXTURE).is_err());
    }
    #[test]
    #[ignore = "requires cached, checksum-pinned upstream archives in subtitle-trial.local"]
    fn actual_linux_and_windows_archives_extract_and_verify() {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        for spec in [LINUX, WINDOWS] {
            let fixture = Fixture::new();
            let path = repo
                .join("subtitle-trial.local/downloads")
                .join(spec.archive);
            let job = super::super::fixture_job();
            download::verify(
                &Download {
                    url: "",
                    bytes: spec.bytes,
                    sha256: spec.sha256,
                },
                fs::metadata(&path).unwrap().len(),
                &digest_file(&path, &job.cancel).unwrap(),
            )
            .unwrap();
            unpack(spec, &path, &fixture.stage(), &job).unwrap();
        }
    }
}
