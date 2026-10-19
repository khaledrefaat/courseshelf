use super::{Job, paths::*};
use std::{
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, atomic::Ordering},
    thread,
    time::{Duration, Instant},
};

pub fn helper(resource: &Path, name: &str) -> Result<PathBuf, String> {
    let path = resource.join("subtitle-helpers").join(if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.into()
    });
    if !path.is_file()
        || crate::fs_links::is_link(
            &fs::symlink_metadata(&path).map_err(|_| "Generation helper is unavailable.")?,
        )
    {
        return Err("Subtitle helpers are not installed. Developers: run pnpm prepare:subtitles before building.".into());
    }
    Ok(path)
}

fn optimized_cpu_available() -> bool {
    #[cfg(target_arch = "x86_64")]
    {
        // Runtime detection includes OS support for AVX state. Match every
        // instruction set enabled in the optimized CMake build, not just AVX2.
        optimized_features([
            std::is_x86_feature_detected!("sse4.2"),
            std::is_x86_feature_detected!("bmi2"),
            std::is_x86_feature_detected!("avx"),
            std::is_x86_feature_detected!("avx2"),
            std::is_x86_feature_detected!("fma"),
            std::is_x86_feature_detected!("f16c"),
            // MSVC /arch:AVX2 may also emit scalar BMI/bit-count instructions.
            std::is_x86_feature_detected!("bmi1"),
            std::is_x86_feature_detected!("lzcnt"),
            std::is_x86_feature_detected!("popcnt"),
            std::is_x86_feature_detected!("movbe"),
        ])
    }
    #[cfg(not(target_arch = "x86_64"))]
    false
}

fn optimized_features(features: [bool; 10]) -> bool {
    features.into_iter().all(|supported| supported)
}

fn transcription_threads(available: usize) -> usize {
    available.clamp(1, 6)
}

fn whisper_helper(resource: &Path) -> Result<PathBuf, String> {
    whisper_helper_for_cpu(resource, optimized_cpu_available())
}

fn whisper_helper_for_cpu(resource: &Path, optimized: bool) -> Result<PathBuf, String> {
    // Older/debug builds may only contain the portable helper.
    if optimized && let Ok(path) = helper(resource, "whisper-cli-avx2") {
        return Ok(path);
    }
    helper(resource, "whisper-cli")
}

fn run(job: &Arc<Job>, mut command: Command, audio: Option<&Path>) -> Result<(), String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW; no console flashes.
    }
    // Hold the slot through spawn so a close/cancel cannot miss a child that is
    // between its cancellation check and registration in the job.
    let mut slot = job.child.lock().unwrap_or_else(|e| e.into_inner());
    cancelled(&job.cancel)?;
    let mut child = command
        .spawn()
        .map_err(|_| "Could not start subtitle helper.")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Could not monitor subtitle helper.")?;
    *slot = Some(child);
    drop(slot);
    let reader_job = job.clone();
    let reader = thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if line.contains("progress")
                && let Some(value) = line
                    .split_whitespace()
                    .find_map(|word| word.trim_end_matches('%').parse::<u8>().ok())
                    .filter(|v| *v <= 100)
            {
                reader_job.progress.store(value, Ordering::Relaxed);
            }
            // Deliberately do not forward helper logs: they include private file paths.
        }
    });
    let started = Instant::now();
    let result = loop {
        let exceeded =
            audio.is_some_and(|path| fs::metadata(path).is_ok_and(|m| m.len() > 512 * 1024 * 1024));
        if job.cancel.load(Ordering::SeqCst)
            || exceeded
            || started.elapsed() > Duration::from_secs(24 * 3600)
        {
            job.kill();
            break Err(if exceeded {
                "Audio exceeds the temporary-file limit (512 MiB)."
            } else {
                "Cancelled or generation timed out."
            }
            .into());
        }
        let status = job
            .child
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_mut()
            .ok_or("Subtitle helper disappeared.")?
            .try_wait();
        match status {
            Ok(Some(status)) => {
                break if status.success() {
                    Ok(())
                } else {
                    Err("Subtitle helper failed. Check available disk space, audio format and helper compatibility.".into())
                };
            }
            Err(_) => {
                job.kill();
                break Err("Could not monitor subtitle helper.".into());
            }
            Ok(None) => thread::sleep(Duration::from_millis(100)),
        }
    };
    if let Some(mut child) = job.child.lock().unwrap_or_else(|e| e.into_inner()).take() {
        let _ = child.wait();
    }
    let _ = reader.join();
    result
}

pub fn transcribe(
    resource: &Path,
    source: &Path,
    model: &Path,
    directory: &Path,
    job: &Arc<Job>,
) -> Result<PathBuf, String> {
    let wav = directory.join("audio.wav");
    job.stage("Extracting audio", None);
    let mut ffmpeg = Command::new(helper(resource, "ffmpeg")?);
    ffmpeg
        .args([
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-format_whitelist",
            "mov,matroska,webm",
            "-i",
        ])
        .arg(source)
        .args([
            "-map",
            "0:a:0",
            "-vn",
            "-sn",
            "-dn",
            "-ar",
            "16000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            "-n",
        ])
        .arg(&wav);
    run(job, ffmpeg, Some(&wav))?;
    job.stage("Generating English subtitles", Some(0));
    let output = directory.join("generated");
    let mut whisper = Command::new(whisper_helper(resource)?);
    let threads = transcription_threads(thread::available_parallelism().map_or(4, usize::from));
    whisper
        .arg("-m")
        .arg(model)
        .arg("-f")
        .arg(&wav)
        .args(["-l", "en", "-t"])
        .arg(threads.to_string())
        .args(["-ng", "-pp", "-ovtt", "-of"])
        .arg(output);
    run(job, whisper, None)?;
    let path = directory.join("generated.vtt");
    if !fs::metadata(&path).is_ok_and(|m| m.is_file() && m.len() > 0 && m.len() <= MAX_VTT) {
        return Err("Generated subtitles are empty or exceed the 2 MiB limit.".into());
    }
    let text = fs::read_to_string(&path).map_err(|_| "Generated subtitles are not valid UTF-8.")?;
    if !text.starts_with("WEBVTT") || !text.contains("-->") {
        return Err("No speech subtitles were generated.".into());
    }
    fs::remove_file(wav).map_err(|_| "Could not clean temporary audio.")?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn worker_threads_are_bounded_by_available_parallelism_and_six() {
        for (available, expected) in [(0, 1), (1, 1), (2, 2), (4, 4), (6, 6), (12, 6), (64, 6)] {
            assert_eq!(transcription_threads(available), expected);
        }
    }
    #[test]
    fn optimized_helper_requires_every_instruction_set_and_has_a_portable_fallback() {
        assert!(optimized_features([true; 10]));
        for index in 0..10 {
            let mut features = [true; 10];
            features[index] = false;
            assert!(!optimized_features(features));
        }
        let root =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("target/subtitle-helper-selection-test");
        let directory = root.join("subtitle-helpers");
        fs::create_dir_all(&directory).unwrap();
        let suffix = if cfg!(windows) { ".exe" } else { "" };
        let portable = directory.join(format!("whisper-cli{suffix}"));
        let optimized = directory.join(format!("whisper-cli-avx2{suffix}"));
        fs::write(&portable, "test fixture, never executed").unwrap();
        assert_eq!(whisper_helper_for_cpu(&root, true).unwrap(), portable);
        fs::write(&optimized, "test fixture, never executed").unwrap();
        assert_eq!(whisper_helper_for_cpu(&root, false).unwrap(), portable);
        assert_eq!(whisper_helper_for_cpu(&root, true).unwrap(), optimized);
        fs::remove_file(optimized).unwrap();
        fs::remove_file(portable).unwrap();
        fs::remove_dir(directory).unwrap();
        fs::remove_dir(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn cancellation_terminates_the_child_and_reaps_it() {
        let job = super::super::fixture_job();
        let running = job.clone();
        let worker = thread::spawn(move || {
            let mut command = Command::new("/bin/sleep");
            command.arg("30");
            run(&running, command, None)
        });
        let start = Instant::now();
        while job.child.lock().unwrap().is_none() && start.elapsed() < Duration::from_secs(2) {
            thread::sleep(Duration::from_millis(5));
        }
        job.kill();
        assert!(worker.join().unwrap().is_err());
        assert!(start.elapsed() < Duration::from_secs(5));
        assert!(job.child.lock().unwrap().is_none());
    }
    #[test]
    #[ignore = "requires pnpm prepare:subtitles and the isolated benchmark fixtures/model"]
    fn real_helpers_extract_and_transcribe_a_short_clip() {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let run_id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = repo.join(format!("subtitle-trial.local/process-smoke-{run_id}"));
        fs::create_dir_all(&directory).unwrap();
        let resource = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources");
        let source = repo.join("subtitle-trial.local/benchmark/speech.mp4");
        let model = repo.join("subtitle-trial.local/downloads/ggml-base.en.bin");
        let job = super::super::fixture_job();
        let output = transcribe(&resource, &source, &model, &directory, &job).unwrap();
        assert!(fs::read_to_string(&output).unwrap().contains("-->"));
        assert!(!directory.join("audio.wav").exists());
        fs::remove_file(output).unwrap();
        fs::remove_dir(directory).unwrap();
    }
}
