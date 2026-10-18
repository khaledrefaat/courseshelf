# Ubuntu release

Courseshelf 0.2.0 targets Ubuntu 24.04 or newer with WebKitGTK 4.1. Build on the
oldest Ubuntu release you intend to support; newer glibc builds are not portable
to older distributions. No signing or automatic updates are configured.

## Build

Install the Tauri 2 Linux build prerequisites and pnpm/Rust beforehand. This
workflow does not install anything system-wide. Keep the lockfiles committed
with the source; run the following from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm check:rust
pnpm tauri build --debug --bundles deb
pnpm tauri build --bundles deb
```

Node is pinned in `.nvmrc`; pnpm is pinned by `packageManager` in package.json.
`pnpm lint` checks the whole repository, including Tailwind directives.
Safe mechanical fixes are `pnpm lint:fix`; formatting only is `pnpm format`.
Debug packages are under
`src-tauri/target/debug/bundle/deb/`; normal releases are under
`src-tauri/target/release/bundle/deb/`. Both have the same package name/version:
do not confuse the two. The normal release has no devtools feature enabled.

The debug bundle uses the **production** CSP and opens its inspector at startup.
You can run `src-tauri/target/debug/courseshelf` directly to inspect it without
installing a package. Quit all other copies first: dev/debug/release use the same
database and single-instance identity. Use the console to check CSP errors while
opening dialogs/menus, choosing a cover, playing/seeking and writing notes.
The backup menu is intentionally hidden, so use the documented manual backup
procedure instead. Do not paste or share media URLs: they contain a session secret.

Only regenerate icons when the source artwork changes:

```sh
pnpm tauri icon design/icon-source.png
cp src-tauri/icons/32x32.png public/favicon.png
```

CI in `.github/workflows/ci.yml` checks pushes and pull requests. Frontend and Rust
jobs run separately on Ubuntu 24.04, cache pnpm/Cargo, and have read-only repository
permissions. CI does not build/publish packages or deploy anything.

An optional AppImage can be attempted after the release build:

```sh
pnpm tauri bundle --bundles appimage
```

AppImage is not the default target; its linuxdeploy tooling and GStreamer setup
may vary between hosts. An AppImage was also built successfully on Ubuntu 24.04
without extra setup; it still needs the native playback checks below and is not
a guarantee that every codec is bundled. The primary installation path is the deb.

Build warnings about Vite's future native config loader and the existing large
frontend chunk are non-fatal; they are not CSP violations.

## Install, verify, uninstall

Replace the filename with the generated release deb (architecture may differ):

```sh
sudo apt install ./src-tauri/target/release/bundle/deb/Courseshelf_0.2.0_amd64.deb
courseshelf
```

When testing a rebuilt package with the same installed version, use
`sudo apt install --reinstall ./src-tauri/target/release/bundle/deb/Courseshelf_0.2.0_amd64.deb`.
Quit the old process and stop dev before relaunching; replacing the package does
not replace code already running in memory.

The deb depends on `gstreamer1.0-libav`, `gstreamer1.0-plugins-base` and
`gstreamer1.0-plugins-good`, in addition to Tauri's generated GTK/WebKit runtime
dependencies. `gstreamer1.0-plugins-bad` is recommended, not mandatory; apt installs
recommendations by default. Codec availability still depends on the actual file.

The window starts maximized, not fullscreen. Verify the launcher icon/name,
1280x800 restored default size and 960x640 minimum. Play a
previously registered course without re-picking its folder, seek in both
directions, pause/resume, then quit/relaunch and check progress and notes. Launch
`courseshelf` a second time: it should focus the first window instead of opening
a second database user. Single-instance uses the user's desktop D-Bus session;
it is not a cross-user or cross-session database lock.

Inspect metadata without installing:

```sh
dpkg-deb --info ./src-tauri/target/release/bundle/deb/Courseshelf_0.2.0_amd64.deb
dpkg-deb --contents ./src-tauri/target/release/bundle/deb/Courseshelf_0.2.0_amd64.deb
```

Uninstall the package:

```sh
sudo apt remove courseshelf
```

Uninstall does not remove your user database, covers or persisted grants. No
uninstall script deletes personal data or video files.

## Identity, data and backups

The identifier remains `com.khaled.courseshelf`; changing the display name does
not move any data. Default locations on Ubuntu:

| Data | Location |
| --- | --- |
| SQLite database (and possible WAL/SHM) | `~/.config/com.khaled.courseshelf/courseshelf.db` |
| Cover copies | `~/.local/share/com.khaled.courseshelf/covers/` |
| Persisted filesystem grants | `~/.local/share/com.khaled.courseshelf/.persisted-scope` |

`XDG_CONFIG_HOME` and `XDG_DATA_HOME` override those base directories. Cover paths
in the database are absolute; moving app data manually does not rewrite them.

Before upgrades, make a backup using the manual procedure (the backup menu is hidden).
The consistent SQLite export contains
progress, notes and course paths, but not covers, videos or folder grants.
See [Back up and restore](backup-and-restore.md) for integrity checks and the
manual restore procedure. Always quit every app copy before restoring.

## Content Security Policy

Linux production content is loaded from `tauri://localhost`, not the development
server. The policy in `tauri.conf.json` has these directives:

| Directive | Reason |
| --- | --- |
| `default-src 'none'` | Deny unspecified resource types, including frames/workers. |
| `script-src 'self'` | Bundled scripts only; no unsafe-inline or unsafe-eval. Tauri adds its own hashes/nonces. |
| `style-src 'self'` | Bundled CSS; Tauri nonces authorize the anchor and Base UI's runtime style elements. |
| `style-src-attr 'unsafe-inline'` | React gradient styles and Base UI geometry/progress styles require style attributes. Does not authorize inline scripts. |
| `img-src 'self' blob:` | Bundled images and validated cover-image blobs. No data or remote images needed. |
| `font-src 'self'` | Bundled Inter font files only. |
| `connect-src ipc: http://ipc.localhost` | Tauri IPC transport only; no remote fetches. |
| `media-src http://127.0.0.1:*` | Existing loopback video server on its random port. |
| `object-src 'none'` | No embedded objects/plugins. |
| `base-uri 'none'` | Prevent injected base URLs. |
| `form-action 'none'` | No form submission/navigation endpoints. |

Tauri's CSP rewriting remains enabled. A Vite post-transform inserts an inert
style anchor; Tauri assigns its nonce in bundled HTML. React reads the anchor's
`nonce` property and supplies it to Base UI's CSPProvider. The nonce is generated
by Tauri, not a static token in the source. It is not persisted or logged.

`devCsp` keeps the same strict scripts, but additionally allows inline CSS for
Vite HMR and HTTP/WebSocket connections to localhost/127.0.0.1 on ports
1420/1421. React refresh's preamble is served as an external same-origin module,
not an inline script. LAN `TAURI_DEV_HOST` addresses are deliberately not allowed
by this policy. Debug **bundles** do not use these development relaxations.

The media URL has the destination Host `127.0.0.1:<port>` regardless of the
page origin. The server requires that exact Host, checks the session token and
canonical registered root, and sends no Access-Control-* headers. Native
`<video>` without a crossOrigin attribute can load cross-origin media in no-CORS
mode; JS fetch/canvas access is not granted. Do not add crossOrigin or switch to
fetch-based playback without reviewing this contract. Tests cover the production
Origin header with both valid and invalid Host values. The playback server itself
is unchanged by packaging.

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
| `register_course_roots` | `lib/playback.ts` startup | Canonical roots inside persisted fs scope. |
| `register_course_root` | `lib/playback.ts` add/locate | Same root validation. |
| `unregister_course_root` | `lib/playback.ts` removal | Removes only in-memory registration. |
| `get_media_session` | `lib/playback.ts` | Local frontend obtains loopback session details. |
| `get_lesson_url` | `lib/playback.ts` | Registered course, safe video path; no traversal/symlinks. |
| `canonicalize_course_root` | `add-course/folders.ts` | Existing selected/granted folder only. |
| `scan_course_folder` | `lib/scanner/scanCourse.ts` | Strict walker, persisted fs grant, skips symlinks. |
| `validate_backup_target` | `lib/db/backup.ts` | Read-only destination validation before/after export. |
| `actual_window_fullscreen` | `course/windowFullscreenState.ts` | Read-only main-thread GTK/GDK state query for the invoking main window; returns null on non-GTK platforms. |

Unused template `greet` and opener were removed. No external-link opener remains.
`core:default` is replaced by the seven enumerated core permissions. No
`protocol-asset` Cargo feature, `assetProtocol` config or `$HOME/**` capability is
enabled. Single-instance focus and debug inspector access run in Rust, so neither
needs additional frontend window permissions.

Automated checks cannot replace a real WebKitGTK run: verify dialogs, menus,
gradients, covers, playback and the console in the debug bundle before release.

## Player keyboard and fullscreen checks

On Linux, the first startup operation in `src-tauri/src/main.rs` sets
`WEBKIT_DISABLE_DMABUF_RENDERER=1` **only when the variable is absent**.
It runs before `courseshelf_lib::run()`, any application threads, the Tauri builder
and webview creation. No shell/system settings are modified; non-Linux builds
compile out the step. Both dev and packaged builds use the same default.

The user confirmed this workaround fixes black/white seek frames on the affected
machine. It disables WebKitGTK's faster DMABUF rendering path and can trade
performance for compatibility. Existing environment values are never overwritten,
including `0`, empty and non-Unicode values (`var_os` checks presence, not string parsing).

Override it for one launch:

```sh
# Quit every existing copy before either command (single-instance).
WEBKIT_DISABLE_DMABUF_RENDERER=0 courseshelf
# Or, for a development run:
WEBKIT_DISABLE_DMABUF_RENDERER=0 pnpm tauri dev
# Restore Courseshelf's default (unset only for this child process):
env -u WEBKIT_DISABLE_DMABUF_RENDERER courseshelf
```

With `0`, Courseshelf does not force DMABUF off; WebKit's own driver/renderer
checks still apply, so this does not guarantee hardware acceleration is active.
Unsetting the variable restores the app's default `1`; it is not an opt-out.
See [Tauri's Linux graphics troubleshooting](https://v2.tauri.app/develop/debug/linux-graphics/).

Rust 2024 makes `std::env::set_var` unsafe because environment mutation may race
with other threads, including native-library readers. The small documented
`unsafe` block stays inline at the very start of `main`, while application startup
is still single-threaded, **not** in a Tauri setup hook or parallel Rust test.
This placement is the safety invariant; a mutex around later environment writes
would not protect native readers. See [Rust's set_var safety contract](https://doc.rust-lang.org/std/env/fn.set_var.html).

After rebuilding, fully quit the previous process, install the new deb (use
`--reinstall` if it is still version 0.2.0), then launch `courseshelf` normally.
Test seeking without a flag, and compare with the explicit `0` override above.
A canvas-based retained-frame experiment produced noise/white frames in the real WebKitGTK
webview and was removed. The exact engine/graphics cause is not confirmed. Do not claim seamless
seeking based on fake-media tests; verify keyboard skips and native scrubbing in the actual app.

Native video controls remain enabled. Space toggles playback; Left/Right seek
10 seconds, Up/Down change volume by 10%, `m` mutes, and `f` toggles fullscreen.
Escape exits video fullscreen. These are Course-page-local handlers, not global
desktop shortcuts. They ignore editable fields, IME composition, modifiers,
tab/menu/listbox focus and visible menus/dialogs. Focused buttons/links keep their
Space activation. Lesson navigation focuses the player without scrolling.

Wrapper Fullscreen API is attempted first, including WebKit-prefixed APIs. The
indicator remains inside wrapper fullscreen. Unsupported/rejected requests fall
back automatically to Tauri window fullscreen and CSS-only player expansion;
the original window fullscreen flag is recorded first and restored on exit,
unmount/page departure and management/removal. The video is never remounted just
to enter/exit fullscreen. Native-control fullscreen is tracked via standard and
WebKit events; window fallback also checks resize/focus and polls while active
because OS fullscreen exits need not emit DOM fullscreenchange events. An OS exit
clears video fullscreen mode rather than forcing the window back into fullscreen.
On Linux, `actual_window_fullscreen` verifies the actual GDK FULLSCREEN state,
not Tao's cached last-requested flag. Its direct GTK dependency was already
transitive through Tauri; it adds no new capability or window mutation.
Window transitions wait for actual-state confirmation (bounded to about one
second) before being considered complete, rather than trusting the IPC acknowledgement.

The fallback never changes window size or maximization. Tests simulate a
maximized window with fullscreen=false and verify it returns to that state, but
the actual desktop compositor's maximize/restore behavior still needs manual
verification. The configured restored/minimum sizes stay unchanged.

WebKitGTK 2.52.6 is installed on the build host; its documented Fullscreen API
setting defaults to enabled, and Wry's Linux setup does not override it. The
agent's GTK display probe failed, so native control clicks, fullscreenEnabled /
webkitFullscreenEnabled values, real user-gesture fullscreen promises and
WebKit's native Space activation cannot be claimed as end-to-end tested here.
At the end of a lesson, a five-second countdown offers Cancel (S) before opening
the next available lesson and attempting playback (WebKitGTK may block autoplay).
Reaching 90% does not start the countdown; the final lesson has none. Replay,
seeking, leaving/hiding the page or managing a course cancels it. Pending progress
and notes writes settle before navigation; cancellation remains available during
that wait. S follows the same editing/IME/menu/dialog guards as other shortcuts.
Video-only native fullscreen exits at ended so the countdown is accessible;
wrapper/window fullscreen remains active. Check this behavior in the real app.

Node/fake-media tests cover application logic only. No optional speed shortcuts
were added: absence of a native speed menu could not be verified.

After rebuilding (an already-installed deb will not update itself):

1. Open a course: verify native play/pause, seek bar and volume. Click a lesson,
   then press Space once. Repeat after Next/Previous and after focusing the native
   video. Each physical Space press must toggle exactly once, including key release.
2. Verify Left/Right move 10 seconds, clamp at the ends and do not scroll. Pause
   after a seek, leave and return: progress must be retained. Seek across 90% while
   playing, then Undo and cross it again: Undo must remain respected for the visit.
3. Verify volume clamps at 0/100%; raising volume unmutes. Indicators must fade
   and never intercept a mouse click on the video controls.
4. Type Arabic/mixed text and use IME, Space and arrows in notes and dialog inputs.
   Nothing should control playback. Test menu arrows, notes tabs and a focused
   button's Space activation as well.
5. Press `f`, then `f`/Escape to exit. Try the native fullscreen button, then `f`
   and Escape; try exiting with the OS. Verify layout, paused/playing state and
   position stay unchanged. In wrapper mode the indicator should remain visible.
6. To exercise the automatic fallback in the debug inspector, temporarily replace
   the player wrapper's requestFullscreen with a rejecting function (reload to
   restore). Confirm `f` enters window fullscreen, and exit returns to a maximized
   window, not true fullscreen or a resized window. Also navigate away/remove a
   course while fullscreen using the app's normal actions or an inspector-driven
   route change, and verify original window state is restored.

In the inspector, check `document.fullscreenEnabled` and
`document.webkitFullscreenEnabled`. Inspect `document.fullscreenElement` (or
`document.webkitFullscreenElement`) after `f` and the native fullscreen button.
A request evaluated directly in the console may fail without transient user
activation; the actual `f` handler calls requestFullscreen directly from the
keyboard gesture. Do not interpret a console-only rejection as lack of support.
