use super::{Job, paths::*};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::Path,
    sync::{Arc, atomic::Ordering},
    time::Duration,
};

fn verify_download(size: u64, digest: &str) -> Result<(), String> {
    if size != MODEL_BYTES || digest != MODEL_HASH {
        return Err("Model checksum verification failed. Please retry the download.".into());
    }
    Ok(())
}

pub fn ensure_model(
    root: &Path,
    job: &Arc<Job>,
    consent: bool,
) -> Result<std::path::PathBuf, String> {
    let models = directory(root, "models")?;
    let model = models.join("ggml-base.en.bin");
    job.stage("Checking model", None);
    if fs::symlink_metadata(&model)
        .is_ok_and(|m| m.is_file() && !crate::fs_links::is_link(&m) && m.len() == MODEL_BYTES)
        && digest_file(&model, &job.cancel)? == MODEL_HASH
    {
        return Ok(model);
    }
    if !consent {
        return Err(
            "The English model is missing or invalid. Confirm its download to continue.".into(),
        );
    }
    let part = models.join("ggml-base.en.bin.part");
    // A single generation owns this exact temporary filename.
    if part.exists() {
        fs::remove_file(&part).map_err(|_| "Could not remove interrupted model download.")?;
    }
    let result = (|| {
        job.stage("Downloading English model", Some(0));
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                let url = attempt.url();
                let host = url.host_str().unwrap_or("");
                if attempt.previous().len() >= 5
                    || url.scheme() != "https"
                    || !(host == "huggingface.co"
                        || host.ends_with(".huggingface.co")
                        || host.ends_with(".hf.co")
                        || host.ends_with(".xethub.hf.co"))
                {
                    attempt.error("Model redirect is not approved")
                } else {
                    attempt.follow()
                }
            }))
            .build()
            .map_err(|_| "Could not create model downloader.")?;
        let mut response = tauri::async_runtime::block_on(async {
            client
                .get("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin")
                .send()
                .await?
                .error_for_status()
        })
        .map_err(|_| "Model download failed. Check your connection and try again.")?;
        if response
            .content_length()
            .is_some_and(|size| size != MODEL_BYTES)
        {
            return Err("Model download has an unexpected size.".into());
        }
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&part)
            .map_err(|_| "Could not start model download; check disk space.")?;
        let mut sha = Sha256::new();
        let mut received = 0_u64;
        loop {
            cancelled(&job.cancel)?;
            let Some(buffer) = tauri::async_runtime::block_on(response.chunk())
                .map_err(|_| "Model download interrupted. Retry when online.")?
            else {
                break;
            };
            received += buffer.len() as u64;
            if received > MODEL_BYTES {
                return Err("Model download exceeded its expected size.".into());
            }
            file.write_all(&buffer)
                .map_err(|_| "Could not save model; check disk space.")?;
            sha.update(&buffer);
            job.progress
                .store((received * 100 / MODEL_BYTES) as u8, Ordering::Relaxed);
        }
        verify_download(received, &format!("{:x}", sha.finalize()))?;
        file.sync_all()
            .map_err(|_| "Could not finish saving model.")?;
        drop(file);
        cancelled(&job.cancel)?;
        if model.exists() {
            fs::remove_file(&model).map_err(|_| "Could not replace invalid model.")?;
        }
        fs::rename(&part, &model).map_err(|_| "Could not install verified model.")?;
        Ok(model.clone())
    })();
    if result.is_err() {
        let _ = fs::remove_file(part);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn truncated_or_tampered_models_are_never_accepted() {
        assert!(verify_download(MODEL_BYTES, MODEL_HASH).is_ok());
        assert!(verify_download(MODEL_BYTES - 1, MODEL_HASH).is_err());
        assert!(verify_download(MODEL_BYTES + 1, MODEL_HASH).is_err());
        assert!(verify_download(MODEL_BYTES, &"0".repeat(64)).is_err());
    }
}
