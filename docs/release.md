# Ubuntu builds and release maintenance

For the published Windows and Ubuntu downloads, see the [README](../README.md#download).
Ubuntu packages target **Ubuntu 24.04 x64** with WebKitGTK 4.1. Build on the oldest
Ubuntu version you intend to support; newer glibc builds may not run on older systems.

The source version is **0.3.1**. Building produces
`Courseshelf_0.3.1_amd64.deb`; the Windows workflow produces
`Courseshelf_0.3.1_x64-setup.exe`. These are not published automatically.

The current source additionally contains **unreleased lesson/course flashcards**; the
published 0.3.1 installers do not. Back up before testing: migration 0006 adds
saved sets/cards and cited transcript excerpts. Migration 0007 expands AI-added
context to 1,200 characters while preserving existing cards/edits and publication
triggers. Applied migrations are not edited. Optional cloud generation uses
the user's session-only Z.ai key after consent; offline video/subtitle behavior
is unchanged. No key, SDK or extra model is bundled. See [flashcards](flashcards.md)
for privacy, limits, cancellation and manual checks. Do not describe an existing
published installer as containing this feature until a new release is built/tested.

This release adds offline English subtitle generation for individual lessons and
whole courses, optional no-overwrite `.en.vtt` export, CPU-optimized helpers with
a portable fallback, and double-click player fullscreen. Back up before upgrading:
the subtitle metadata migration (0005) runs automatically. Published 0.3.0 download
links stay unchanged until the new installers are uploaded and verified.

Only the small Whisper helpers are bundled. FFmpeg is downloaded directly from
its pinned upstream release after consent (~131 MiB Ubuntu / ~163 MiB Windows),
as is the separate ~142 MiB English model. Existing local FFmpeg files in the
legacy resource directory are excluded by the narrower resource map. Preparing
helpers no longer fetches FFmpeg. Downloads live in app data and are reused offline;
see [subtitle generation](subtitle-generation.md) for integrity and license details.

## Prerequisites and build

Use the Node version in .nvmrc, pnpm from package.json's packageManager field,
and stable Rust with rustfmt and Clippy. Ubuntu packages:

~~~sh
sudo apt install build-essential pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev \
  libxdo-dev libssl-dev librsvg2-dev libayatana-appindicator3-dev patchelf \
  gstreamer1.0-libav gstreamer1.0-plugins-base gstreamer1.0-plugins-good
~~~

gstreamer1.0-plugins-bad is recommended for additional playback support. From the
repository root:

~~~sh
pnpm install --frozen-lockfile
pnpm prepare:subtitles
pnpm check
pnpm check:rust
pnpm tauri build --bundles deb -- --locked
~~~

The installer is in **src-tauri/target/release/bundle/deb/**. To inspect production
CSP with devtools, use the same build command with --debug; that package is under
target/debug/bundle/deb instead. Share only the normal release package.
Both builds use the same app identity and data, so fully quit other copies first.

Regenerate icons only after changing the source artwork:

~~~sh
pnpm tauri icon design/icon-source.png
cp src-tauri/icons/32x32.png public/favicon.png
~~~

The normal CI workflow checks pushes and pull requests. Windows packaging uses a
separate [manual workflow](windows.md). Neither publishes releases automatically.
Vite's existing native-config compatibility and large-chunk warnings are non-fatal.

## Install and uninstall

From the repository root:

~~~sh
sudo apt install ./src-tauri/target/release/bundle/deb/Courseshelf_0.3.1_amd64.deb
courseshelf
~~~

For a rebuilt package with the same installed version, add --reinstall to apt.
Quit the old process before launching the replacement. Apt installs GTK/WebKit and
the declared GStreamer dependencies; actual codec support depends on the video.

~~~sh
sudo apt remove courseshelf
~~~

Uninstalling removes the app, not your videos or user database. Data locations,
backup integrity checks and safe manual restoration are documented in
[backup and restore](backup-and-restore.md). The identifier is
**com.khaled.courseshelf**; changing it would move data locations.

## Publishing a release

1. Run the checks, build from the reviewed commit and test the installed package.
2. Confirm package metadata with dpkg-deb --info and contents with dpkg-deb --contents.
3. Create a GitHub release/tag targeting the commit used for that build.
4. Attach the .deb before publishing; do not upload personal databases or course files.
5. For immutable releases, save a draft and check all attachments before publishing.
   A published asset cannot be replaced; use a new release for a corrected build.
6. Update the README's platform-specific links. Do not use a single latest-release
   download URL while Windows and Ubuntu are published under different tags.

The 0.2.0 Ubuntu preview is published under
[v0.2.0-ubuntu-new](https://github.com/khaledrefaat/courseshelf/releases/tag/v0.2.0-ubuntu-new).
No automatic updater or signing is configured. Use preview labels until ready for
wider distribution.

## Security maintenance

0.3.1 builds package fixed CPU-only generation helpers (not the model).
Preparation, licensing/source-distribution obligations, installer-size impact and
manual checks are documented in [subtitle generation](subtitle-generation.md).
Do not distribute new installers until these helper obligations and native tests
are completed. The published 0.3.0 downloads are unchanged.

Production scripts/styles/fonts stay local; Tauri adds CSP hashes/nonces for
bundled code and Base UI runtime styles. Inline style attributes are allowed for
gradients/positioning, not inline scripts. Covers use blob URLs. Media is limited
to the token-protected 127.0.0.1 server on its random port. Its exact Host check,
canonical-root checks and absence of permissive CORS headers must remain intact.

Production origins are tauri://localhost on Linux and http://tauri.localhost on
Windows. Native video loads without crossOrigin; do not replace this with fetch
or canvas access without reviewing that contract. Development additionally allows
Vite styles and local HMR. Debug bundles use production CSP, not devCsp.
Inspect the bundled app's console for CSP errors when changing these areas.

Run dependency audits separately before releases (pnpm audit, and cargo audit if
cargo-audit is installed). Passing typecheck/lint/tests is not a dependency audit.

## Capability audit

Only the local `main` window is authorized; no remote URL capabilities are
configured. Paths below are repository-relative call sites.

| Permission | Call site and purpose | Scope |
| --- | --- | --- |
| `core:path:allow-resolve-directory` | `add-course/covers.ts`, `edit-cover/courseActions.ts`, `library/coverCache.ts`: `appDataDir()` | Resolve app-data directory only; no file IO. |
| `core:path:allow-join` | `features/library/add-course/covers.ts`: `join()` | Path manipulation only. |
| `core:event:allow-listen` | `features/course/closeProgress.ts`: `onCloseRequested()` | Main-window close listener. |
| `core:event:allow-unlisten` | Same listener's cleanup, `src/main.tsx` HMR dispose | Remove event listeners. |
| `core:window:allow-destroy` | `onCloseRequested()` internally destroys after bounded flush | Main window only. |
| `core:window:allow-set-fullscreen` | `course/windowFullscreenState.ts`: `setWindowFullscreen()` | Main window only; automatic video-fullscreen fallback and original-state restoration. No resize/maximize API. |
| `core:window:allow-is-fullscreen` | `course/windowFullscreenState.ts`: `isFullscreen()` | Main window only; standard state query, verified against GTK on Linux because Tao's cached flag can miss OS exits. |
| `dialog:allow-open` | Add/edit cover, add/locate folders | User-selected files/folders; dialog extends fs scope. |
| `dialog:allow-save` | `course-management/BackupMenu.tsx` | User-selected backup destination. |
| `fs:deny-default` | All frontend fs operations | Plugin's protected/default deny rules, including webview data. |
| `fs:allow-read-file` | `add-course/covers.ts:readCover`, `library/coverCache.ts` | `$APPDATA/covers/**` plus picker/restored grants. |
| `fs:allow-stat` | `add-course/covers.ts:readCover` checks size before read | Existing fs grants; no additional static paths. |
| `fs:allow-mkdir` | `add-course/covers.ts:writeCourseCover` | `$APPDATA/covers` target; recursive creation creates absent parents. |
| `fs:allow-write-file` | Same helper: collision-safe cover copy | `$APPDATA/covers/**`. |
| `fs:allow-remove` | Same helper's rollback and `edit-cover/courseActions.ts` cleanup | `$APPDATA/covers/**`. |
| `sql:allow-load` | `lib/db/db.ts`: `Database.load()` | App SQLite connection; plugin offers no per-query ACL. |
| `sql:allow-select` | Helpers in `lib/db/` | App reads; no per-table ACL. |
| `sql:allow-execute` | Helpers in `lib/db/`, including backup `VACUUM INTO` | App writes; no per-statement ACL. Backup target separately validated in Rust. |

Filesystem plugin scopes are shared across its allowed commands: static cover
scopes are not independent per-operation sandboxes. Picker/restored grants can
also authorize paths for other allowed fs operations. The app's cover helpers
restrict write/removal targets to covers; course scanning/playback are separately
validated in Rust. This audit does not claim that a compromised frontend has
per-command, per-table or read-only course-root filesystem isolation.

Custom invokes (not plugin ACL permission names):

| Command | Frontend call site | Backend restriction |
| --- | --- | --- |
| `flashcards_key` | `flashcards/service.ts`, password dialog | Main window; validates/holds a key in Rust session memory, reports only readiness, Forget clears/cancels. Never serialized to files/DB. |
| `flashcards_prepare` | Same service/panel | Main window; registered/granted bounded sidecar/generated reads; source fingerprints and scoped checkpoint reads. No HTTP. |
| `flashcards_begin` | Same service after confirmation | Main window; source revalidation, one global job, bounded contiguous sections, explicit fresh/resume; no arbitrary path or endpoint. |
| `flashcards_request` | Same service/pipeline | Main window; current job, ordered single-attempt stages, bounded messages/body, fixed HTTPS provider/model, no redirects/retries; checkpoints received content/usage only. |
| `flashcards_cancel` | Same service, close and management | Main window; cancels matching in-memory work; no arbitrary process operations. |
| `flashcards_validate_job` | Same service before SQL publication | Main window; current job, completed received stages and fresh matching source. |
| `flashcards_finish` | Same service after save/failure | Main window; releases current settled job, cleans only its known checkpoint files after saving. |
| `flashcards_discard` | Same service, removal cleanup | Main window; known course/lesson-owned app-data checkpoint names only, no links/reparse points, no recursive unknown-file removal. |
| `subtitle_generation_status` | `course/subtitleGeneration.ts` | Reports one in-memory job and fixed model/helper availability; no file content. |
| `start_subtitle_generation` | Same service | One job; registered/granted lesson; English only; explicit consent for fixed HTTPS FFmpeg/model downloads, size/SHA-256 verification and bounded extraction. No frontend HTTP or process permission. |
| `cancel_subtitle_generation` | Same service, course management | Cancels matching job/course and kills its helper; no arbitrary PID/process command. |
| `validate_generated_subtitle_job` | Same service before DB save | Only the current ready job's bounded staged VTT. |
| `finish_subtitle_generation` | Same service after DB save | Commits or discards that job's app-owned output only. |
| `read_generated_subtitle` | Same service | Registered lesson, source fingerprint and owned app-data filename; no arbitrary path or HTTP route. |
| `remove_generated_subtitle` | Same service, removal cleanup | Exact lesson-owned random filename under app-data subtitles only; no links. |
| `export_generated_subtitle` | `course/courseSubtitles.ts` | Copies a validated, source-matched app-data VTT beside its registered/granted lesson; derived destination, no links or overwrites; no new frontend fs grant. |
| `get_lesson_subtitle` | `course/useSubtitles.ts` | Read-only matching VTT/SRT beside a validated registered lesson, persisted fs scope, no links/reparse points; maximum 2 MB. No HTTP route or new permission. |
| `frontend_ready` | `components/StartupReady.tsx` after shell mount | Main window only; Windows reveal-once startup gate, no-op on other platforms. |
| `register_course_roots` | `lib/playback.ts` startup | Canonical roots inside persisted fs scope. |
| `register_course_root` | `lib/playback.ts` add/locate | Same root validation. |
| `unregister_course_root` | `lib/playback.ts` removal | Removes only in-memory registration. |
| `get_media_session` | `lib/playback.ts` | Local frontend obtains loopback session details. |
| `get_lesson_url` | `lib/playback.ts` | Registered course, safe video path; no traversal/symlinks. |
| `canonicalize_course_root` | `add-course/folders.ts` | Existing selected/granted folder only. |
| `scan_course_folder` | `lib/scanner/scanCourse.ts` | Strict walker, persisted fs grant, skips symlinks. |
| `validate_backup_target` | `lib/db/backup.ts` | Read-only destination validation before/after export. |
| `actual_window_fullscreen` | `course/windowFullscreenState.ts` | Read-only main-thread GTK/GDK state query for the invoking main window; returns null on non-GTK platforms. |

No external-link opener is enabled.
`core:default` is replaced by the seven enumerated core permissions. No
`protocol-asset` Cargo feature, `assetProtocol` config or `$HOME/**` capability is
enabled. Single-instance focus and debug inspector access run in Rust, so neither
needs additional frontend window permissions.

Automated checks cannot replace a real WebKitGTK run: verify dialogs, menus,
gradients, covers, playback and the console in the debug bundle before release.

## Player keyboard and fullscreen checks

Courseshelf defaults **WEBKIT_DISABLE_DMABUF_RENDERER=1** on Linux to work around
black/white frames during seeking on the affected setup. The default is set only
when the environment variable is absent, at the very start of main before
application threads, Tauri and webview creation. It does not modify your shell or
system environment and has no effect on Windows.

Any existing value is preserved, including 0 or an empty value. Disabling DMABUF
may trade performance for compatibility. To opt out for one launch:

~~~sh
# Fully quit every other copy first: the app is single-instance.
WEBKIT_DISABLE_DMABUF_RENDERER=0 courseshelf
# Development:
WEBKIT_DISABLE_DMABUF_RENDERER=0 pnpm tauri dev
# Restore the app's default for this launch:
env -u WEBKIT_DISABLE_DMABUF_RENDERER courseshelf
~~~

The override does not guarantee hardware acceleration; WebKit's own checks still
apply. Rust 2024 makes environment mutation unsafe, so the documented unsafe block
must remain at the very start of main, not in setup or a parallel test.

Before sharing a new build, check it in the real native app:

- Native play/pause, scrubbing and volume; Arrow Up/Down and player-hover wheel
  volume changes only in fullscreen (including window fallback). Outside fullscreen,
  scrolling over the player scrolls normally without changing volume. Check no
  colored focus outline surrounds the video after clicking or keyboard focus;
  keyboard shortcuts and native controls remain usable. Left/Right seeks, saved
  positions and resume.
- One Space press toggles only once. Editing notes, IME, tabs, menus and dialogs
  must not trigger player shortcuts.
- Completion at 90%, manual undo, end-of-lesson countdown and Cancel (S); the final
  lesson has no auto-advance. Pending saves settle before navigation.
- Click a sidebar lesson's completion circle to mark it complete or incomplete;
  clicking its title still opens that lesson.
- f/Escape and the native fullscreen button; exiting restores layout, position and
  the previous window state, including maximization. Wrapper fullscreen is tried
  first, with a Tauri window fallback; Linux reads actual GTK state.
- Restart and play an existing course without re-picking; verify covers, notes,
  counts, Locate folder and safe rescanning with a missing/empty test root.
- Launch a second instance; it should focus the first. Make a backup before
  upgrade/restore tests and use disposable copies of course folders.

Fake-media tests cannot verify codecs, graphics drivers, native dialogs or actual
fullscreen. Do not reintroduce canvas frame retention: it previously produced
noise/white frames in WebKitGTK. See [Tauri's graphics guide](https://v2.tauri.app/develop/debug/linux-graphics/)
for platform troubleshooting.
