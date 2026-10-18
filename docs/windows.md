# Windows installer builds and testing

The Windows x64 NSIS installer is built on GitHub's Windows runner. You and your
friends do **not** need Rust, Visual Studio, Node or pnpm to install/run it. The
first Windows build and real WebView2 behavior must be verified before sharing;
Linux checks are not a substitute for that test.

## Build without installing development tools on Windows

1. Review, commit and push the changes yourself. The agent does not commit or push.
   The `Windows installer` workflow needs to exist on the repository's default
   branch before GitHub exposes its manual **Run workflow** button.
2. Open the repository on GitHub → **Actions** → **Windows installer** →
   **Run workflow**. Select the branch containing the reviewed code and run it.
3. The job installs the pinned Node/pnpm versions and Rust on a disposable
   `windows-2022` x64 runner, runs `pnpm check` and `pnpm check:rust`, and builds:

   ```sh
   pnpm tauri build --target x86_64-pc-windows-msvc --bundles nsis -- --locked
   ```

4. After the job succeeds, open its run page and download the
   **Courseshelf-windows-x64-N** artifact at the bottom. GitHub sign-in may be
   required. Artifacts expire after 14 days; download the ZIP before then.
5. Extract the ZIP. It contains a `*-setup.exe` and a `.sha256` checksum file.
   Send the extracted installer to friends after testing, not the source code
   or a Linux `.deb`. No release is published automatically and no updater is added.

The workflow is manual-only, uses `contents: read`, needs no signing secrets,
and caches dependencies. It does not change the existing Ubuntu checks. A first
build can take longer while the runner downloads/builds its toolchain and crates.
Private repository runs are subject to your account's Actions usage/billing.

## Install and runtime prerequisites

Initial test target: **Windows 11 x64**, not ARM64 or 32-bit Windows.
Quit all running copies, then double-click the extracted setup executable.
Installation is per user. The identifier remains `com.khaled.courseshelf`.

The installer downloads/installs the **Microsoft Edge WebView2 Runtime** when
needed; allow internet for this step. This is not a fully offline installer.
Once installed, Courseshelf itself uses local files and the loopback playback
server. GStreamer is a Linux dependency, not a Windows requirement. Media support
depends on the codecs available to WebView2/Windows; an MP4 extension alone does
not guarantee playback. Test your actual H.264/AAC course videos, and other
encodings separately. Windows N or uncommon encodings may need Microsoft media
features/codecs; do not bundle arbitrary third-party codec packs.

These test installers are **unsigned**. Windows can show Unknown publisher or
SmartScreen warnings, and some policies (including Smart App Control) can block
them. Do not disable Windows security globally to install them. Signing and public
distribution are separate future decisions. A successful CI build is not proof
of runtime safety or compatibility.

Optional checksum verification in PowerShell:

```powershell
Get-FileHash .\Courseshelf_0.2.0_x64-setup.exe -Algorithm SHA256
```

Use the actual generated filename and compare with the accompanying `.sha256`.
The checksum detects corruption; it does not authenticate an unsigned publisher.

## Data and backups

Tauri's Windows app-data and app-config locations currently resolve under:

```text
%APPDATA%\com.khaled.courseshelf\
  courseshelf.db        (and possible -wal / -shm files)
  covers\
  .persisted-scope
```

The app installs its own database/migrations for each Windows user. It does not
package your personal database, covers, grants or courses. Ubuntu's identifier,
data locations and Linux renderer workaround are unchanged.

Do not share your live database as the installer. It contains private notes and
absolute course paths. Ubuntu paths and persisted grants are not portable to
Windows: prefer adding folders fresh for initial testing. A restored database
would need matching Windows paths via Locate folder and separately restored cover
copies with valid Windows `cover_path` values; grants must be picked again.
See [backup and restore](backup-and-restore.md). Always fully quit before a manual
restore; do not overlay a database while SQLite has it open.

## Dual-boot verification checklist

Use a small **copy made by you** of a test course to safely test missing/relocated
files. Courseshelf never changes course files itself.

- Install and launch: plum icon, maximized window, sensible restored/minimum size;
  check light/dark themes, menus, dialogs and cover previews.
- Add a nested course from a local drive using Arabic names, spaces and `# % +`.
  Windows does not allow `?` in filenames. Check title autofill, sections and order.
- Add/change/remove a cover, remove a test course: only that app-owned cover is
  cleaned up; original images/videos stay untouched. Restart and check the cover.
- Fully quit and relaunch. Play the previously added course **without re-picking**.
  Confirm restored grants, registration and library counts; missing folders offer
  Locate folder, not an empty destructive sync.
- Test play/pause, volume, forward/back seeks and dragging native seek controls;
  save/resume positions, Start over, completion at 90%, manual undo and library
  freshness. At ended, test countdown, Cancel (S) and the next lesson.
- Test f/Escape, native fullscreen controls, maximized-window restoration and
  page departure while fullscreen. Confirm native controls remain usable.
- Type Arabic/mixed notes, switch lessons quickly, retry saves and restart.
- On the disposable test course, rescan, mark a file missing, restore it and
  relocate the root. Matching lessons keep progress/notes. An unreadable or empty
  root must not wipe progress.
- Open a second copy: it focuses the first instead of opening another DB user.
  Reinstall the same installer over the installed version and check data remains.
- Uninstall via Windows **Settings → Apps → Installed apps → Courseshelf**.
  Test that course files are untouched; personal data should be retained unless
  you explicitly choose a user-data removal option in the installer/uninstaller.

Drive roots, UNC/verbatim paths and reparse points need special care. The scanner
normalizes lesson-relative paths to `/`. Junctions/reparse points inside a course
are skipped by the walker and rejected by playback; use fully local, downloaded
files rather than cloud placeholders/reparse-backed lesson trees for this test.
No broad filesystem grants, asset protocol, CORS wildcard or CSP relaxation is added.
Windows keeps Tauri's default `http://tauri.localhost` production webview origin,
not HTTPS. Native media uses `http://127.0.0.1:<random-port>` without `crossOrigin`;
the server still checks its own exact loopback Host and secret, not the page's Host.
Tests cover both production origins without adding CORS headers. Actual WebView2
media/CSP behavior still requires the checklist above.

## References

- [Tauri Windows installer and WebView2 options](https://v2.tauri.app/distribute/windows-installer/)
- [Tauri platform configuration merging](https://v2.tauri.app/develop/configuration-files/#platform-specific-configuration)
- [Microsoft SmartScreen guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
