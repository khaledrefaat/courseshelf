# Windows installation and builds

The maintainer has tested the **0.2.0 Windows x64 preview** successfully on Windows.
It is still an early personal project, not a guarantee for every machine or codec.

## Install the published version

1. [Download the Windows installer](https://github.com/khaledrefaat/courseshelf/releases/download/v0.2.0/Courseshelf_0.2.0_x64-setup.exe).
2. Quit any running copy, then run the setup executable. Installation is per user.
3. Launch Courseshelf and add a local course folder.

No Rust, Visual Studio, Node or pnpm is needed to use the installer. It downloads
Microsoft Edge WebView2 when missing, so initial setup may need internet access.
GStreamer is only a Linux dependency. Media support depends on WebView2/Windows
and the video's actual codecs; an MP4 extension alone does not guarantee playback.

The installer is unsigned. Unknown publisher/SmartScreen warnings or policy blocks
are possible; do not disable Windows security globally to install it.
There is no automatic updater. Download and install a new version when available.

A brief startup-window animation has been reported and deferred for investigation;
the maintainer reports the app works afterward.

[Release notes and checksum](https://github.com/khaledrefaat/courseshelf/releases/tag/v0.2.0)
are available on GitHub. To check the downloaded installer in PowerShell:

~~~powershell
Get-FileHash .\Courseshelf_0.2.0_x64-setup.exe -Algorithm SHA256
~~~

Compare with the accompanying .sha256 file. A matching checksum detects corruption,
not the identity of an unsigned publisher.

## Build through GitHub Actions

The toolchain is installed on GitHub's runner, not your Windows computer.

1. Commit/push the reviewed source yourself. The workflow must exist on the
   repository's default branch before GitHub shows its manual run button.
2. Open **Actions → Windows installer → Run workflow**, select the branch to build,
   and start it.
3. After success, download and extract the **Courseshelf-windows-x64-N** artifact.
   It contains the setup .exe and checksum. Artifacts expire after 14 days and may
   require GitHub sign-in, so publish tested installers as GitHub Release assets.

The windows-2022 runner uses the pinned Node/pnpm versions, installs stable Rust,
runs pnpm check and pnpm check:rust, then builds:

~~~sh
pnpm tauri build --target x86_64-pc-windows-msvc --bundles nsis -- --locked
~~~

The workflow is manual-only, caches dependencies, uses contents: read, and does
not automatically publish a release. Private repositories use your Actions quota.
The Windows-only Tauri config selects NSIS/current-user installation and WebView2's
download bootstrapper; Ubuntu config, identity, CSP and capabilities stay unchanged.

For each new release, use the source commit actually built by the successful run.
Attach the extracted setup .exe and checksum to a release draft before publishing.
Immutable releases cannot have their assets replaced afterward.

## Data and portability

The app identifier is **com.khaled.courseshelf**. Windows database/config and
cover/grant data normally live under:

~~~text
%APPDATA%\com.khaled.courseshelf\
  courseshelf.db        (and possible -wal / -shm files)
  covers\
  .persisted-scope
~~~

Installers do not include the developer's personal database, notes, courses or
grants. See [backup and restore](backup-and-restore.md) before replacing any data.
Always quit fully before restoring; do not copy only a live database without its WAL.

Ubuntu absolute paths and persisted grants are not portable to Windows. For a
first Windows install, add courses fresh. Moving a database between platforms
would need Locate folder, fresh folder grants and separately restored covers
with valid Windows cover paths.

Lesson-relative paths use / internally. The scanner skips, and playback rejects,
internal junctions/reparse points; use fully local/downloaded videos rather than
cloud placeholders. Windows also forbids ? in filenames.

Windows keeps Tauri's default http://tauri.localhost production origin. Native
media loads from http://127.0.0.1 on a random port without crossOrigin. Exact Host
and token checks remain, without CORS wildcard headers or relaxed CSP.

## Test before sharing a new build

Use disposable copies of course folders for missing-file/relocation checks.

- Add nested courses with Arabic names, spaces and # % +; check titles and ordering.
- Choose/edit/remove a cover; restart and confirm it loads. Removing a course must
  not touch original images or videos.
- Fully quit/relaunch, then play a previously added course **without re-picking**.
- Check native controls, scrubbing, keyboard seeks, saved positions, resume,
  completion/undo, countdown and Cancel (S).
- Check f/Escape and native fullscreen; restore the previous maximized/windowed
  layout without changing playback position.
- Type Arabic/mixed notes, switch lessons quickly, restart and verify saved text.
- Rescan and relocate a disposable course; preserve matching progress/notes.
  Failed or empty scans must not wipe existing progress.
- Launch a second copy: it should focus the first. Check same-version reinstall
  retains data. Uninstall from **Settings → Apps → Installed apps → Courseshelf**;
  do not choose any user-data removal option unless that is intentional.

Automated tests are not a substitute for real native dialogs, codecs and WebView2
rendering. The maintainer's successful test applies to that build/setup.

References: [Tauri Windows packaging](https://v2.tauri.app/distribute/windows-installer/),
[platform config merging](https://v2.tauri.app/develop/configuration-files/#platform-specific-configuration),
[SmartScreen guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).
