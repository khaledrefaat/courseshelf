# Ubuntu release

Courseshelf 0.1.0 targets Ubuntu 24.04 or newer with WebKitGTK 4.1. Build on the
oldest Ubuntu release you intend to support; newer glibc builds are not portable
to older distributions. No signing or automatic updates are configured.

## Build

Install the Tauri 2 Linux build prerequisites and pnpm/Rust beforehand. This
workflow does not install anything system-wide. Keep the lockfiles committed
with the source; run the following from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm tsc --noEmit
pnpm test
cd src-tauri
cargo fmt --check
cargo check --locked
cargo clippy --locked
cargo test --locked
cd ..
pnpm tauri icon design/icon-source.png
cp src-tauri/icons/32x32.png public/favicon.png
pnpm tauri build --debug --bundles deb
pnpm tauri build --bundles deb
```

Run Biome on the files changed for a release (`pnpm exec biome check <files>`),
or `pnpm lint` for a full-tree check. Debug packages are under
`src-tauri/target/debug/bundle/deb/`; normal releases are under
`src-tauri/target/release/bundle/deb/`. Both have the same package name/version:
do not confuse the two. The normal release has no devtools feature enabled.

The debug bundle uses the **production** CSP and opens its inspector at startup.
You can run `src-tauri/target/debug/courseshelf` directly to inspect it without
installing a package. Quit all other copies first: dev/debug/release use the same
database and single-instance identity. Use the console to check CSP errors while
opening dialogs/menus, choosing a cover, playing/seeking, writing notes and saving
a backup. Do not paste or share media URLs: they contain a session secret.

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
sudo apt install ./src-tauri/target/release/bundle/deb/Courseshelf_0.1.0_amd64.deb
courseshelf
```

The deb depends on `gstreamer1.0-libav`, `gstreamer1.0-plugins-base` and
`gstreamer1.0-plugins-good`, in addition to Tauri's generated GTK/WebKit runtime
dependencies. `gstreamer1.0-plugins-bad` is recommended, not mandatory; apt installs
recommendations by default. Codec availability still depends on the actual file.

Verify the launcher icon/name, 1280x800 default window and 960x640 minimum. Play a
previously registered course without re-picking its folder, seek in both
directions, pause/resume, then quit/relaunch and check progress and notes. Launch
`courseshelf` a second time: it should focus the first window instead of opening
a second database user. Single-instance uses the user's desktop D-Bus session;
it is not a cross-user or cross-session database lock.

Inspect metadata without installing:

```sh
dpkg-deb --info ./src-tauri/target/release/bundle/deb/Courseshelf_0.1.0_amd64.deb
dpkg-deb --contents ./src-tauri/target/release/bundle/deb/Courseshelf_0.1.0_amd64.deb
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

Before upgrades, use **Back up data...**. The consistent SQLite export contains
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
| `dialog:allow-open` | Add/edit cover, add/locate folders, `course/useCourseScanCheck.ts` | User-selected files/folders; dialog extends fs scope. |
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
| `canonicalize_course_root` | `add-course/folders.ts`, `course/useCourseScanCheck.ts` | Existing selected/granted folder only. |
| `scan_course_folder` | `lib/scanner/scanCourse.ts` | Strict walker, persisted fs grant, skips symlinks. |
| `validate_backup_target` | `lib/db/backup.ts` | Read-only destination validation before/after export. |

Unused template `greet` and opener were removed. No external-link opener remains.
`core:default` is replaced by the five enumerated core permissions. No
`protocol-asset` Cargo feature, `assetProtocol` config or `$HOME/**` capability is
enabled. Single-instance focus and debug inspector access run in Rust, so neither
needs additional frontend window permissions.

Automated checks cannot replace a real WebKitGTK run: verify dialogs, menus,
gradients, covers, playback and the console in the debug bundle before release.
