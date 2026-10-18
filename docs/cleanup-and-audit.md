# 0.2.0 cleanup and audit notes

This report records the cleanup-only changes. A subsequent Linux startup change
now defaults the renderer workaround when unset; see [release notes](release.md#player-keyboard-and-fullscreen-checks).
Historical renderer statements below describe the cleanup before that change.

This is a source/tooling cleanup, not a renderer or feature change. The application
identifier, database schema/migrations, playback server, CSP and capabilities are unchanged.

## Removed

- The `/dev/spike` route and its lazy loading boundary.
- `VideoSpike.tsx`, `CourseScanTest.tsx`, `useCourseScanCheck.ts` and
  `lastTestCourse.ts`: temporary playback/scanner UI, localStorage position/last-course
  storage, scan logging and test-only buttons. No production progress data was deleted.
  Old browser localStorage keys are inert; no startup storage-clearing code was added.
- Successful startup playback-registration `console.log` output. Sanitized error
  diagnostics remain.
- Unused template logos: `src/assets/react.svg`, `public/tauri.svg`, `public/vite.svg`.
- The unreferenced `courses.getByRootPath` helper left behind by the scanner spike.
- Unused generated shadcn parts: Dialog trigger/close/footer wrappers; dropdown
  portal/group/label/submenu/checkbox/radio/separator/shortcut wrappers; Progress
  label/value; Select group/label/separator. Unused public variant/helper exports
  were made private where still needed internally.
- Unused direct Rust `serde_json` dependency. It still exists transitively where
  Tauri/plugins require it; this is not an upgrade or removal of its transitive uses.

## Kept intentionally

- Every one of the nine shadcn component files has real consumers; only unused parts
  were trimmed. Portals/overlays, progress track/indicator and select scroll arrows
  needed internally remain, with rendered behavior unchanged.
- The deliberately hidden `BackupMenu.tsx`, export helper, Rust target validation,
  permission and backup tests. Hiding that entry was requested separately; cleanup
  does not re-enable or remove backup functionality.
- `src/lib/utils.ts`: referenced by `components.json` for future shadcn generation.
- The shadcn package: `src/index.css` imports `shadcn/tailwind.css`; it is not merely
  an unused CLI dependency. All other JS dependencies have source, CSS, configuration
  or build/test consumers; no JS packages were removed or upgraded.
- Production progress, notes, scanning, durations, media and security tests and all
  numbered migrations. Documented table-helper APIs used by those tests remain.
- React StrictMode, hot-reload cleanup and debug-build inspector startup. These are
  development safeguards/production-CSP diagnostics, not throwaway spike UI.
- Generated multi-platform icon assets: part of the Tauri icon set, not build output.
- System-theme behavior, native controls, single-instance registration and all
  playback guards. No new renderer flag is hardcoded. The canvas experiment stays removed.

## Repository hygiene

Reviewed the current tracked-file inventory with `git ls-files`, filename checks,
file sizes and high-signal credential-pattern checks. Deleted spike/template files
are omitted from the filesystem scan.

- No tracked database files, SQLite sidecars, backups, environment files or private
  key files found.
- No personal absolute `/home/...` or `/Users/...` paths found in tracked text.
  The stable app identifier `com.khaled.courseshelf` and author metadata are intentional.
- No tracked file larger than 1 MiB found.
- No high-signal AWS/GitHub/OpenAI token or private-key marker matches found.
- Ignore rules cover node_modules, dist, Cargo target output, local env files,
  SQLite databases/sidecars and typical backup extensions. Example env files may
  still be committed intentionally.

These are heuristic working-tree/index checks, not proof that no secret has ever
existed. Git history and screenshot pixels were not exhaustively audited. No
history rewrite, commit or push was performed.

## Dependency audit

- `pnpm audit --json`: **1 high**, 0 critical/moderate/low findings.
- Affected: `braces@3.0.3` via shadcn's fast-glob/micromatch chains
  (including @shadcn/registry and ts-morph).
- Advisory: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
  stack-exhaustion denial of service through deeply nested patterns.
  Reported affected range: <=3.0.3; patched: >=3.0.4.
- This is a tooling dependency chain, not a claim of a tested remotely exploitable
  video-player issue. The package is present as a normal dependency because shadcn
  also supplies imported CSS.
- No override, lockfile dependency upgrade or advisory suppression was applied.
- `cargo audit --version`: cargo-audit is not installed. No system-wide tool was
  installed; Rust dependency advisories were **not audited**.

The initial sandboxed pnpm audit failed to fetch registry data; the successful
retry used network access. Audit findings are reported, not made into a CI gate
that would hide or silently upgrade the existing dependency.

## Checks and CI limits

The frontend gate is `pnpm check`; Rust is `pnpm check:rust`, including clippy for
all targets with `-D warnings`. Node 22.19.0 and pnpm 11.17.0 pin the existing
local frontend toolchain; no runtime upgrade is implied.

Final results: 254 frontend tests (the existing 250 plus four quality/CI guards)
and all 17 Rust tests pass. Typecheck, repository-wide Biome, format check,
clippy with denied warnings and the normal release deb build pass. AST/printer
comparisons confirm that retained functions in the seven trimmed/formatted UI
modules have unchanged implementations.

The generated `Courseshelf_0.2.0_amd64.deb` was inspected with `dpkg-deb`:
package `courseshelf`, version `0.2.0`, architecture `amd64`, expected executable,
desktop entry, icons and GStreamer/GTK/WebKit dependencies. It was not installed
by the agent. The optional manual backup recipe was verified against a disposable
SQLite fixture: read-only source, VACUUM INTO, valid header, integrity `ok` and
matching row count. No personal database was opened or modified.

The local sandbox denies loopback binding. The existing server test passes when
the Rust gate is rerun with loopback access; it was not skipped or weakened.
CI jobs have normal runner networking, use frozen/locked dependencies, cache stores,
and do not publish or deploy. Their major-version action tags were checked against
the upstream repositories. The workflow YAML was parsed locally; an actual hosted
run still requires the user to push.

Use [release verification](release.md) after installing the rebuilt deb. Automated
tests cannot verify native dialogs, fullscreen, actual codec playback or the DMABUF
renderer issue in the real WebKitGTK window.
