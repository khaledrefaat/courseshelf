Generated helper binaries and upstream notices are placed here by:
  pnpm prepare:subtitles
Do not replace them with executables from PATH. The English model is NOT bundled.
Both whisper-cli and whisper-cli-avx2 are required for release builds. Rust checks
all required CPU features before selecting AVX2; older CPUs use the portable helper.
Review docs/subtitle-generation.md before distributing installers.
