use super::{Job, paths::cancelled};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::Path,
    sync::{Arc, atomic::Ordering},
    time::Duration,
};

pub struct Download<'a> {
    pub url: &'a str,
    pub bytes: u64,
    pub sha256: &'a str,
}

fn approved_url(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none_or(|port| port == 443)
        && matches!(
            url.host_str(),
            Some(
                "github.com"
                    | "release-assets.githubusercontent.com"
                    | "objects.githubusercontent.com"
            )
        )
}

pub fn verify(spec: &Download<'_>, bytes: u64, digest: &str) -> Result<(), String> {
    if bytes != spec.bytes || digest != spec.sha256 {
        return Err(
            "FFmpeg download checksum/size verification failed. Retry the download.".into(),
        );
    }
    Ok(())
}

pub fn fetch(spec: &Download<'_>, path: &Path, job: &Arc<Job>) -> Result<(), String> {
    cancelled(&job.cancel)?;
    if !approved_url(&reqwest::Url::parse(spec.url).map_err(|_| "Invalid FFmpeg URL.")?) {
        return Err("FFmpeg download URL is not approved.".into());
    }
    job.stage("Downloading FFmpeg", Some(0));
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(2 * 3600))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !approved_url(attempt.url()) {
                attempt.error("FFmpeg redirect is not approved")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|_| "Could not create FFmpeg downloader.")?;
    let mut response = tauri::async_runtime::block_on(async {
        client.get(spec.url).send().await?.error_for_status()
    })
    .map_err(|_| "FFmpeg download failed. Check your connection and retry.")?;
    if response
        .content_length()
        .is_some_and(|size| size != spec.bytes)
    {
        return Err("FFmpeg download has an unexpected size.".into());
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| "Could not start FFmpeg download. Check disk space and permissions.")?;
    let mut sha = Sha256::new();
    let mut received = 0_u64;
    loop {
        cancelled(&job.cancel)?;
        let Some(chunk) = tauri::async_runtime::block_on(response.chunk())
            .map_err(|_| "FFmpeg download interrupted. Retry when online.")?
        else {
            break;
        };
        received += chunk.len() as u64;
        if received > spec.bytes {
            return Err("FFmpeg download exceeded its size limit.".into());
        }
        file.write_all(&chunk)
            .map_err(|_| "Could not save FFmpeg download. Check disk space.")?;
        sha.update(&chunk);
        job.progress
            .store((received * 100 / spec.bytes) as u8, Ordering::Relaxed);
    }
    verify(spec, received, &format!("{:x}", sha.finalize()))?;
    file.sync_all()
        .map_err(|_| "Could not finish saving FFmpeg download.")?;
    cancelled(&job.cancel)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unapproved_redirects_and_incomplete_or_tampered_downloads() {
        for url in [
            "http://github.com/tool",
            "https://evil.github.com/tool",
            "https://github.com.evil.test/tool",
            "https://github.com:444/tool",
            "https://user:pass@github.com/tool",
            "file:///bin/ffmpeg",
        ] {
            assert!(!approved_url(&reqwest::Url::parse(url).unwrap()));
        }
        for host in [
            "github.com",
            "release-assets.githubusercontent.com",
            "objects.githubusercontent.com",
        ] {
            assert!(approved_url(
                &reqwest::Url::parse(&format!("https://{host}/tool")).unwrap()
            ));
        }
        let spec = Download {
            url: "https://github.com/tool",
            bytes: 10,
            sha256: "expected",
        };
        assert!(verify(&spec, 10, "expected").is_ok());
        assert!(verify(&spec, 9, "expected").is_err());
        assert!(verify(&spec, 11, "expected").is_err());
        assert!(verify(&spec, 10, "tampered").is_err());
    }
}
