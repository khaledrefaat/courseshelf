# Courseshelf

**Your personal library for offline video courses.**

Courseshelf brings progress tracking, saved playback positions and notes to the
courses you already have on your computer. Pick a course folder, start watching,
and see how far you've come. Your videos stay where they are.

## Why I built it

I like watching courses offline, but a folder full of videos doesn't tell me where
I left off, how much I've watched, or which courses I've finished.

On learning platforms, that progress is visible. I can see completed lessons,
watch a progress bar move forward, and feel that I'm getting somewhere. With
offline courses, I missed that feeling. Even when I was learning, it was harder
to see my progress and keep going.

That's why I built Courseshelf: a personal course library that makes offline
learning feel more organized and rewarding. I built it for myself, and I'm
sharing it with friends and anyone else who likes learning this way.

## Download

Version **0.3.1** is available as an early preview for Windows and Ubuntu.
Feedback from other machines is welcome.

| Platform | Installer | Release notes |
| --- | --- | --- |
| Windows x64 | [Download for Windows (.exe)](https://github.com/khaledrefaat/courseshelf/releases/download/v0.3.1-windows2/Courseshelf_0.3.1_x64-setup.exe) | [Windows preview](https://github.com/khaledrefaat/courseshelf/releases/tag/v0.3.1-windows2) |
| Ubuntu 24.04 x64 | [Download for Ubuntu (.deb)](https://github.com/khaledrefaat/courseshelf/releases/download/v0.3.1-ubuntu/Courseshelf_0.3.1_amd64.deb) | [Ubuntu preview](https://github.com/khaledrefaat/courseshelf/releases/tag/v0.3.1-ubuntu) |

No Rust or development tools are needed to install either version.

**New in 0.3.1:** offline English subtitle
generation, a whole-course queue with optional `.en.vtt` exports, optimized CPU
helpers, and double-click fullscreen. FFmpeg and the English model download on
first use with your permission, keeping the installers small.

### Windows

Download and run Courseshelf_0.3.1_x64-setup.exe. The installer may need internet
access to install Microsoft Edge WebView2 if it's missing.

The installer is unsigned, so Windows may show an Unknown publisher or SmartScreen
warning. Some security policies may block unsigned apps; don't disable Windows
security globally to install it.

### Ubuntu

Download the .deb, open a terminal in its folder, and run:

~~~sh
sudo apt install ./Courseshelf_0.3.1_amd64.deb
~~~

Launch Courseshelf from your applications menu. Apt installs the required runtime
dependencies and may need internet access. Quit any running copy before updating.

## What you can do

- **Build your own shelf:** add folders of MP4, M4V and WebM lessons, with editable
  course titles and covers. Folder names become sections, with natural ordering.
- **See your progress:** completed lessons, course percentages, status filters and
  a Continue card make it easy to see what's started and what's finished. Mark a
  lesson complete or incomplete directly from its sidebar circle.
- **Pick up where you stopped:** playback positions are saved automatically.
- **Keep notes beside the lesson:** plain-text notes autosave, with an all-notes
  view for each course.
- **Watch comfortably:** native video controls, keyboard shortcuts, player-hover
  mouse-wheel volume, fullscreen and a five-second next-lesson countdown you can
  cancel with S.
- **Watch with subtitles:** matching VTT/SRT files load automatically, with a
  remembered On/Off toggle. Generate English subtitles
  for a lesson or a whole course—see [subtitle generation](#generate-english-subtitles-031).
- **Keep your library up to date:** rescan or relocate a course without losing
  matching lessons' progress and notes. Missing files are marked, not forgotten.
- **Make it feel at home:** light and dark colors follow your system theme.

## Getting started

1. Click **Add course** and browse to a folder containing video lessons.
2. Check the detected lessons, edit the title or choose a cover, then add it.
3. Open the course and start watching. Progress, positions and notes are saved locally.
4. Return to your library to continue where you left off.

Watching, progress, notes and subtitle transcription need no accounts or cloud
service. The optional flashcard feature described below sends a transcript to
Z.ai only after confirmation and uses your own API key/credits. Courseshelf does not
download courses: you supply your own local videos. Removing a course from the
library removes its Courseshelf data, not the video files on disk.

Back up your progress and notes before moving data or upgrading. See the
[backup and restore guide](docs/backup-and-restore.md) for data locations and
manual instructions. Database backups do not include videos, cover images,
generated subtitle files, FFmpeg or the downloaded model.

## Lesson flashcards (unreleased source feature)

**Not included in the 0.3.1 installers linked above.** In a build from this source,
open a lesson and use the **Flashcards** panel above notes:

1. Have an existing matching VTT/SRT or generate English subtitles first.
2. Click **Generate flashcards**, enter your own Z.ai API key for this app session,
   and confirm the transcript upload and credit use. No video or notes are uploaded.
3. Flip through concept-focused question/answer cards, their transcript excerpts
   and separately labeled AI-added context. Saved cards work offline, with local editing/deletion.
4. At lesson end, saved cards open automatically instead of the next-lesson countdown.
   Use **Previous card** / **Next card** to review. Closing this automatic review,
   including with **Escape**, saves pending progress/notes and advances to the next
   available lesson. Closing a manually opened review stays on the current lesson;
   the final lesson stays put. Failed saves prevent automatic advancement.
   Lessons without cards keep the five-second countdown. Generation never runs automatically.

For a whole course, choose **Manage → Generate course flashcards…**. The preview
shows eligible lessons, skipped saved sets, transcript/checkpoint issues and an upper
bound on new API requests. Confirm transcript uploads/credit use to process missing
sets sequentially. Existing cards and edits—including zero-card results—are never
replaced. Generate course subtitles first if transcripts are missing.

The global status bar continues across navigation and offers Cancel. Received
compatible work can be reused under your confirmation; uncertain/malformed checkpoints
need individual attention. There are no automatic retries. Restarting never resumes
spending: preview again to skip completed lessons and reuse safe partial work.

Received AI responses that fail validation are listed separately as retryable failures.
Select **Retry failed lessons only**, review the retained sections and new-request limit,
then confirm uploads/credit use and click **Retry failed lessons**. Recovery keeps valid
sections before the failure and preserves original checkpoints until cards are saved.
Saved sets are never replaced; unknown request outcomes and corrupt/changed checkpoints
still need individual attention. New requests may spend credits again.

Long lessons are split into bounded sections before whole-lesson selection, rather
than always producing seven cards. Fewer or zero cards is valid when little is taught.
New generation favors clear concept explanations over demo trivia or repetitive
"according to the instructor" wording. Labeled AI-added explanations and examples can
fill gaps in the same concept, up to 1,200 characters, without claiming to recover
unseen slides. Existing sets/edits are kept; regenerate a lesson explicitly to use
the new guidance. Course batches still skip saved sets.
These are AI-generated aids, not verified facts or a replacement for the course.
They cannot see slides. Your key is held in native memory for this session only,
not stored in the database or backups; re-enter it after restarting the app.
There is no model download for flashcards. Internet and Z.ai credits are needed
only for new generation requests; local subtitle generation remains offline.

See [flashcard privacy, limits, resume and testing](docs/flashcards.md). Saved
flashcards and cited excerpts are included in database backups; private partial
checkpoints are not. Back up the existing database before first running this build
(migrations 0006–0007). Migration 0007 preserves existing cards while expanding the
AI-context limit. Published installer links and release versions are unchanged.

For contributors and future development sessions, [decision context](docs/decisions.md)
records why the rendering, generation and build-space safeguards exist; [AGENTS.md](AGENTS.md)
contains the working rules. The Electron experiment is parked on its separate branch,
not part of the current Tauri source or published downloads.

## Course durations (unreleased source feature)

Current source builds show total course length on Library cards, such as `4h 12m`.
Lesson durations are cached in SQLite and reused on later visits and restarts.
Unknown durations are read quietly for the currently filtered courses, at most two
metadata reads at once, without playing videos or changing progress. A dash means
some durations are still unknown or unavailable. Successful rescans invalidate the
cache so changed lessons are measured again. No extra tool or download is required.

## Subtitles

### Use existing subtitles

Place a matching `.vtt` or `.srt` beside the lesson video, for example
`Introduction.mp4` and `Introduction.en.vtt`. Exact filename matches take
priority over English suffixes (`.en`, `.en-US`, `.en-GB`, `.english`), with VTT
preferred within each group. Matching filenames are case-sensitive; extensions
and language suffixes are not. No rescan is needed: subtitles are discovered
when opening a lesson.

Subtitles start on unless you previously switched them off. Use **Subtitles
On/Off** at the top-right of the player; the preference persists across restarts.
The button is hidden when no matching sidecar exists. Native controls remain in
place. Embedded subtitle tracks are not supported.
Basic timed text is supported; VTT styles/regions are ignored. Files must be UTF-8
or BOM-marked UTF-16, at most 2 MB and 10,000 cues. Invalid subtitles show a message
without preventing video playback. Subtitle support is included in 0.3.0; update
older installations to use it.

### Generate English subtitles (0.3.1)

Included in the **0.3.1 installers linked above**. If you use an older version,
install the update to enable generation.

- **One lesson:** open a lesson without subtitles and click **Generate English subtitles**
  below the player. The generated file stays in Courseshelf's app data.
- **Whole course:** choose **Manage → Generate course subtitles…**. Lessons are processed
  one at a time in course order. Existing subtitles are skipped and valid generated
  copies are reused, so rerunning does not start everything from scratch.
- **Save beside your videos:** the course dialog has **Save subtitles beside videos**
  checked by default. It creates `Introduction.en.vtt` beside `Introduction.mp4`,
  while keeping an app-data copy too. Uncheck it for app-data-only output.

The installer includes only the small Whisper helpers. First use asks permission
to download the FFmpeg audio tool (~131 MiB on Ubuntu, ~163 MiB on Windows) and
the English `base.en` model (~142 MiB), listing only what is missing. Both are
verified and saved in app data, not downloaded again for every lesson.
Generation then runs locally on your CPU, offline, without uploading audio or needing
an account or API key. Speed depends on your computer and lesson; programming terms
and names can be transcribed incorrectly. This generates files, not live captions.

The course queue shows progress, Cancel and a final summary, and keeps running when
you navigate elsewhere in the app. Closing the app cancels it; after relaunching,
start the queue again to skip or reuse completed work.

Existing subtitles and videos are never overwritten. Safe folder export requires
a writable filesystem with hard-link support, normally ext4 or NTFS. Read-only
folders and unsupported filesystems such as exFAT show export errors, but generated
subtitles remain usable from Courseshelf's app data. Removing a course does not
delete exported sidecars or videos.

See [subtitle setup, storage, limits and testing](docs/subtitle-generation.md) for
details, including build requirements and what to back up.

## Development

Use Node **22.19.0** (.nvmrc), pnpm **11.17.0** (packageManager), a stable Rust
toolchain with rustfmt and Clippy, and the
[Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform.
Ubuntu build/runtime packages are listed in the [release guide](docs/release.md).

~~~sh
pnpm install --frozen-lockfile
# Prepare bundled Whisper helpers (FFmpeg and the model download on first use).
pnpm prepare:subtitles
pnpm tauri dev
~~~

Quit the installed app before starting dev: they use the same local database and
single-instance identity. To run the quality checks:

~~~sh
pnpm check
pnpm check:rust
~~~

For packaging, see [Ubuntu builds](docs/release.md) and
[Windows builds through GitHub Actions](docs/windows.md). The Windows workflow
builds on GitHub, so you don't need a local Windows toolchain just to test an installer.

## Built with

Tauri 2 and Rust, React and TypeScript, Tailwind CSS v4, shadcn/ui (Base UI),
SQLite, Biome and Vitest. Inter is bundled with the app.

## Feedback

This is a personal project, not a full learning platform. If you try it and find
something wrong, [open an issue](https://github.com/khaledrefaat/courseshelf/issues)
with your OS, app version and steps to reproduce it. Please leave private notes,
course paths and playback URLs out of shared reports.
