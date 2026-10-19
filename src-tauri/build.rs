fn main() {
    // Do not produce a release installer whose generation button cannot work.
    // Debug checks deliberately do not download/build native tools.
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        let suffix = if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
            ".exe"
        } else {
            ""
        };
        for name in ["ffmpeg", "whisper-cli", "whisper-cli-avx2"] {
            let path = format!("resources/subtitle-helpers/{name}{suffix}");
            println!("cargo:rerun-if-changed={path}");
            assert!(
                std::path::Path::new(&path).is_file(),
                "Missing subtitle helper: run pnpm prepare:subtitles before a release build"
            );
        }
    }
    tauri_build::build()
}
