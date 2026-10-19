# Offline English subtitle generation (0.3.1)

Generation is included in the 0.3.1 source. The published 0.3.0 installers play
existing VTT/SRT sidecars only; build/install 0.3.1 to use generation. The model
is downloaded separately after consent, not bundled in the installer.

## Use

Open a lesson with no matching sidecar and click **Generate English subtitles**
below the player. First use asks permission to download the `base.en` model
(147,964,211 bytes, approximately 142 MiB). Confirm **Download and generate**.
The backend verifies its pinned SHA-256 before installing or using the model.
No audio is uploaded. Subsequent jobs work offline with the same shared model.

There is one job at a time, using up to six CPU threads (capped by available
parallelism) and no GPU. The panel shows
the current stage, percentage during download/transcription, and Cancel. Switching
lessons does not stop the job; return to its lesson to see the panel. Closing the
main window cancels it without waiting for it to finish. Cancelling a download
can wait for the active network operation's timeout (10-second read timeout,
15-second connection timeout). No real-time captions or translation.

### Generate a whole course

Choose **Manage → Generate course subtitles…**. **Save subtitles beside videos**
is checked by default; uncheck it for app-data-only output. Confirm the optional
model download if prompted, then start. Only non-missing lessons are included,
in course order, with one helper job at a time. Existing matching VTT/SRT files
are never overwritten. Invalid/unreadable existing sidecars produce a visible
lesson error rather than being replaced. Valid app-data caches are reused and
exported without retranscribing.

The app-wide banner shows the current lesson/stage, completed count, generated,
reused, skipped and failed counts, export counts and Cancel. Individual failures
do not prevent later lessons from running. Navigation does not stop the queue.
Closing the app cancels it with the existing two-second close timeout. No queue
is persisted across restarts: start again to skip existing finished work. Rescan,
relocation and removal cancel the matching queue and drain its in-flight export
before changing the course. Single-lesson generation cannot start alongside it.

Export creates `Introduction.en.vtt` beside `Introduction.mp4`, retaining the
app-data cache as well. A narrow Rust command derives the destination from the
registered lesson, checks the persisted scope, rejects links/reparse points and
revalidates before publication. It accepts no arbitrary destination or text.
No new dependency, migration, frontend capability or CSP change is needed.

A uniquely named `courseshelf-subtitle-<random>.tmp` sibling is written and synced,
then published using an exclusive hard link so even a racing existing file cannot
be overwritten or expose a partial `.vtt`. The temporary name is removed afterward.
**The course filesystem must support hard links** (normally ext4/NTFS). Read-only
folders and unsupported filesystems such as exFAT report export failures, keeping
subtitles usable from the app-data cache. A crash or cleanup failure can leave an
owned temporary file; failures are reported where possible, and no course-folder
sweep runs. Removing a course never deletes exported sidecars. Sidecars subsequently
take precedence over cached subtitles; if a video is replaced, manage its exported
sidecar manually (Courseshelf never rewrites it).

Existing sidecars take priority. Generated subtitles reuse the native text-track
display, current size/position and remembered On/Off preference. Accuracy is not
guaranteed, particularly for proper names and code. Generating never plays the
lesson, changes position/completion, or marks it watched.

## Files and database

Paths below are relative to Tauri's app **data** directory (on Ubuntu, normally
`~/.local/share/com.khaled.courseshelf`; on Windows, `%APPDATA%\com.khaled.courseshelf`).
The existing SQL-plugin database location is unchanged.

- `models/ggml-base.en.bin`: one shared downloaded model, not inside the installer.
- `subtitles/<lesson-id>-<random-id>.en.vtt`: completed generated subtitles.
- `subtitle-jobs/<random-id>/`: temporary audio and staged output; cleaned after
  completion/cancellation, with interrupted job directories retried on startup.
- Migration 0005 adds `generated_subtitles`: lesson ownership, relative filename,
  full source-video SHA-256, model identity/checksum, language, SQL-side timestamps.

Video fingerprints are checked on cache load, so opening a lesson can perform a
background file read. Moving an unchanged course preserves the cache. Replacing
the video invalidates it, even if the replacement has the same size. Missing
lessons retain metadata through rescans. Removing a course cancels its job,
deletes metadata by cascade, and cleans its owned subtitle files best-effort.
Cleanup failures can leave orphaned cache files; there is no automatic sweep.

SQLite metadata is written only after output validation, before staged output is
committed. Failed saves roll back the new metadata and staged files. An interrupted
commit can leave a metadata row with a missing file; it is invalidated on next use,
allowing regeneration. Course-folder writes happen only for the explicitly
enabled sidecar export described above; single-lesson generation stays in app data.

Output is limited to 2 MiB/10,000 cues by the existing subtitle reader/parser.
Temporary decoded audio is capped at 512 MiB (roughly 4.5 hours at 16 kHz mono
16-bit PCM). Jobs time out after 24 hours; disk-full/unsupported audio fails visibly.

Database backups contain metadata, **not subtitle files or the model**. Restored
metadata with absent files is invalidated and subtitles can be regenerated. Back
up `subtitles/` separately if you want to preserve generated text. The model can
be downloaded again; no backup-format changes are made here.

## Prepare a development/release build

```sh
pnpm prepare:subtitles
pnpm check
pnpm check:rust
pnpm tauri dev
```

Preparation downloads checksum-pinned source/helper archives, builds whisper.cpp
v1.9.5 as a CPU-only executable, and obtains a dated LGPL FFmpeg x64 build.
On Linux, missing CMake is obtained locally, not installed system-wide. Windows
uses the runner's CMake/MSVC. End users do not need these build tools or FFmpeg
installed system-wide. No Python/CUDA environment is needed. Windows helper
processes use CREATE_NO_WINDOW to avoid console flashes.

Tool caches and experiments live in ignored `subtitle-trial.local/`. Generated
resources/notices live in ignored `src-tauri/resources/subtitle-helpers/` and are
packaged by Tauri as `subtitle-helpers/`. Release builds reject missing helpers.
Debug Rust checks do not download tools or models. The Windows workflow prepares
helpers before packaging. Linux/Windows x64 are the supported helper targets.

Preparation builds two static whisper executables: `whisper-cli` (portable) and
`whisper-cli-avx2` (optimized). Rust selects the optimized helper only when the CPU
and OS report support for SSE4.2, BMI1/2, AVX, AVX2, FMA, F16C, LZCNT, POPCNT and
MOVBE (including a conservative guard for MSVC's scalar instruction generation).
Missing/unsafe
optimized helpers fall back to the validated portable helper. Release builds
require both variants; debug builds with only the older portable helper still run,
but need `pnpm prepare:subtitles` to get the speed improvement. Neither variant
uses machine-native compiler flags or AVX512. Model and decoding settings are
unchanged; existing generated subtitles remain usable without regeneration.
See Microsoft's [x64 /arch documentation](https://github.com/MicrosoftDocs/cpp-docs/blob/main/docs/build/reference/arch-x64.md)
for compiler-generated scalar instructions in AVX2 builds.

The helpers occupy about **142 MiB uncompressed** on Linux, mostly FFmpeg. Actual
installer compression varies; the separate model adds about 142 MiB once used.
Preparation needs at least 1.5 GB free, plus room for Cargo/build output. The
model, build caches, test audio and private transcripts must never be committed.

All downloader/process operations are narrow Rust commands. No frontend shell,
HTTP or extra filesystem permissions are granted, and CSP/server rules stay intact.
Only pinned helpers run, arguments are passed without a shell, and FFmpeg input
protocols/formats are restricted. Course access reuses registered-root validation
and persisted fs scope; symlinks/reparse points are rejected.

Before redistributing helper binaries, preserve all generated upstream licenses
and `BUILD-SOURCES.txt`, and review the selected FFmpeg build's corresponding-source
and redistribution obligations. A link to source is not a substitute for fulfilling
those obligations. Dated upstream artifacts may expire: if a pinned URL disappears,
fail closed and review/update the URL/checksum together, never silently use latest.
References: [whisper.cpp](https://github.com/ggml-org/whisper.cpp),
[model distribution](https://huggingface.co/ggerganov/whisper.cpp),
[FFmpeg builds](https://github.com/BtbN/FFmpeg-Builds),
[FFmpeg licensing](https://ffmpeg.org/legal.html).

## Manual verification

1. Back up the database, stop any installed copy, then launch dev from these sources.
2. Open a lesson with no subtitles. Confirm the download prompt, progress and Cancel.
3. Generate, then play/seek; verify captions, On/Off and unchanged progress tracking.
4. Generate another lesson, switch away and return. Only that lesson gets its output.
5. Quit fully and relaunch offline: cached subtitles work without re-picking folders
   or downloading the model. A new generation reuses the existing model.
6. Cancel during download, audio extraction and transcription. Retry. Close during
   a job and relaunch; it must not continue in a leftover helper process.
7. Use disposable course copies for replacement/relocation/removal checks. Confirm
   replacement invalidates cache, relocation preserves it, removal leaves originals
   untouched, and removing while notes saves fail still works.
8. Test a missing/corrupt cache file and restored database without `subtitles/`:
   offer generation again rather than failing video playback.
9. Repeat native controls/fullscreen and generation tests in a rebuilt Windows
   installer. Linux tests do not prove Windows helper/resource resolution works.
10. On a disposable course, run the course queue with export checked. Verify a
    matching `.en.vtt` beside each video and unchanged existing VTT/SRT/videos.
    Navigate away/back while it runs; Cancel must remain available. Rerun and
    confirm the completed sidecars are skipped. Try cached lessons: export must
    reuse their text rather than transcribe it again.
11. Uncheck export and verify output stays in app data. Use a read-only folder
    or exFAT drive to verify visible export failures while cached captions work.
    Test cancel/quit and rescan/relocate/remove during processing. Relaunch and
    rerun: completed work is retained; no helpers from the old run remain.

## Local benchmark

On the maintainer's Ryzen 5 5600H, the first 120 seconds of the chosen English
Postgres introduction took **110.80 seconds**, using four CPU threads, CPU-only,
and **391,100 KiB peak RSS (about 382 MiB)**. Development checks were also running;
this is a single sample, not a guarantee for other content or computers. Download,
build and extraction time are excluded. The model SHA-256 matched the pinned value.
The resulting VTT and disposable clip are in `subtitle-trial.local/benchmark/`.

After enabling CPU optimizations, sequential reruns on the same 120-second audio,
same model and unchanged decoding settings measured:

| Helper | Threads | Wall time | Peak RAM |
| --- | --- | --- | --- |
| Original helper (AVX/AVX2/FMA/F16C disabled) | 4 | 141.44 s | 382 MiB |
| Optimized AVX2 helper | 4 | 16.77 s | 382 MiB |
| Optimized AVX2 helper | 6 | 12.58 s | 383 MiB |

The six-thread run was about 11 times faster than the contemporaneous original
helper run. These are single local measurements, not a promise for every lesson;
the earlier 110.80-second baseline also illustrates timing variation. Audio
extraction, model verification and source hashing are excluded. The optimized
four-thread transcript text matched the earlier output, with a 20 ms difference
in the last cue's end time; this is not an accuracy evaluation. Six threads are
now the cap, lowered when fewer logical CPUs are available. Older CPUs retain the
portable path and will not get the same acceleration. No GPU, smaller model,
quantization or reduced beam-search settings were used.

The Rust process runner was also exercised with the actual bundled helpers on a
15-second speech clip: restricted FFmpeg extraction, whisper transcription, VTT
validation and temporary-audio cleanup passed. A two-second clip produced no cues
and was correctly rejected as having no generated speech subtitles. The native
download prompt, WebKitGTK caption rendering and Windows installer still need the
manual checks above; this command-line test does not verify those UI paths.
