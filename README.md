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

Version **0.2.0** is available as an early preview for Windows and Ubuntu. I've
tested the app on both; feedback from other machines is welcome.

| Platform | Installer | Release notes |
| --- | --- | --- |
| Windows x64 | [Download for Windows (.exe)](https://github.com/khaledrefaat/courseshelf/releases/download/v0.2.0-windows-new/Courseshelf_0.2.0_x64-setup.exe) | [Windows preview](https://github.com/khaledrefaat/courseshelf/releases/tag/v0.2.0-windows-new) |
| Ubuntu 24.04 x64 | [Download for Ubuntu (.deb)](https://github.com/khaledrefaat/courseshelf/releases/download/v0.2.0-ubuntu-new/Courseshelf_0.2.0_amd64.deb) | [Ubuntu preview](https://github.com/khaledrefaat/courseshelf/releases/tag/v0.2.0-ubuntu-new) |

No Rust or development tools are needed to install either version.

### Windows

Download and run Courseshelf_0.2.0_x64-setup.exe. The installer may need internet
access to install Microsoft Edge WebView2 if it's missing.

The installer is unsigned, so Windows may show an Unknown publisher or SmartScreen
warning. Some security policies may block unsigned apps; don't disable Windows
security globally to install it.

### Ubuntu

Download the .deb, open a terminal in its folder, and run:

~~~sh
sudo apt install ./Courseshelf_0.2.0_amd64.deb
~~~

Launch Courseshelf from your applications menu. Apt installs the required runtime
dependencies and may need internet access. Quit any running copy before updating.

## What you can do

- **Build your own shelf:** add folders of MP4, M4V and WebM lessons, with editable
  course titles and covers. Folder names become sections, with natural ordering.
- **See your progress:** completed lessons, course percentages, status filters and
  a Continue card make it easy to see what's started and what's finished.
- **Pick up where you stopped:** playback positions are saved automatically.
- **Keep notes beside the lesson:** plain-text notes autosave, with an all-notes
  view for each course.
- **Watch comfortably:** native video controls, keyboard shortcuts, fullscreen and
  a five-second next-lesson countdown you can cancel with S.
- **Keep your library up to date:** rescan or relocate a course without losing
  matching lessons' progress and notes. Missing files are marked, not forgotten.
- **Make it feel at home:** light and dark colors follow your system theme.

## Getting started

1. Click **Add course** and browse to a folder containing video lessons.
2. Check the detected lessons, edit the title or choose a cover, then add it.
3. Open the course and start watching. Progress, positions and notes are saved locally.
4. Return to your library to continue where you left off.

There are no accounts, uploads or required cloud services. Courseshelf does not
download courses: you supply your own local videos. Removing a course from the
library removes its Courseshelf data, not the video files on disk.

Back up your progress and notes before moving data or upgrading. See the
[backup and restore guide](docs/backup-and-restore.md) for data locations and
manual instructions. Backups do not include videos or cover images.

## Development

Use Node **22.19.0** (.nvmrc), pnpm **11.17.0** (packageManager), a stable Rust
toolchain with rustfmt and Clippy, and the
[Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform.
Ubuntu build/runtime packages are listed in the [release guide](docs/release.md).

~~~sh
pnpm install --frozen-lockfile
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
