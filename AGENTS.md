# Courseshelf

Personal desktop app (Ubuntu) to track progress through local video courses (mostly mp4).
Tauri 2 + React + TypeScript + Tailwind v4 + shadcn/ui (Base UI) + SQLite (tauri-plugin-sql).
Package manager: pnpm. Use Tauri 2 APIs only; check the current docs when unsure, never v1 syntax.

## Commands
- Dev: `pnpm tauri dev`
- Typecheck: `pnpm tsc --noEmit`
- Lint/format: `pnpm lint` (Biome). Auto-fix: `pnpm lint:fix`
- Rust: `cd src-tauri && cargo fmt --check && cargo clippy`
Run typecheck and lint before saying a task is done.

## Architecture
- `src/` React frontend. `src-tauri/` Rust shell: keep it thin, prefer plugins over custom Rust.
- Folders: `src/features/{library,course,notes}`, `src/components/ui` (shadcn), `src/lib/db`, `src/lib/scanner`.
- Use `@/` imports for anything under `src/`.
- All SQL lives in `src/lib/db`. Components never write raw SQL.
- Database changes only via numbered migration files. Never edit an applied migration.

## Data rules
- Lessons are identified by their path relative to the course root, so progress survives rescans.
- Rescanning a course must never delete progress or notes.
- Sort lessons with `localeCompare(b, undefined, { numeric: true })`.
- A lesson is complete when manually marked or when 90% watched.
- Covers are copied into the app data directory, never referenced from the original location.

## UI rules
- Tailwind v4: CSS-first config with `@theme`. No tailwind.config.js, no v3 syntax.
- All design tokens live in `src/index.css`. No hardcoded hex values in components.
- Color roles: `primary` (near-black) for main buttons; `brand` (indigo) for progress bars,
  completion checks, active lesson, percentages and links; `brand-soft` for tinted backgrounds.
  `accent` is shadcn's hover surface, never use it as the brand color.
- Font: Inter, bundled via @fontsource-variable/inter. No CDN fonts.
- Light theme only for now.
- No global element styles (`button`, `input`, `a`, `h1`) in CSS. Style through components and utilities.
- shadcn components are added one at a time with `pnpm dlx shadcn@latest add <name>`.
  Use shadcn `progress` for bars (indicator uses `bg-brand`). Don't hand-build what shadcn provides.
- Course cards without a cover use a deterministic pastel gradient (by course id) with the course's
  short label, as in the design.
- Reference screens are in `design/` (library, course-page, add-course-dialog, empty-library). Match layout,
  spacing and colors. The placeholder data in them is fake.

## Design vs MVP scope
The mockups show more than we build first. Do NOT implement yet, unless I ask:
- Custom video controls, speed menu, CC. Use the native `<video controls>`.
- Lesson and section durations (needs reading video metadata, separate task).
- Drag-and-drop for covers. Use the native file picker.
- Search beyond filtering the library by course title.
- The "All notes for this course" tab.
Build as custom components (not in shadcn): the circular progress ring in the course sidebar
and the folder-tree sidebar.


## Code style
- TypeScript strict, no `any`. Small components, hooks for logic.
- Zustand for global UI state. No Redux or other state libraries.
- Biome handles formatting and linting. Don't change `biome.json` without asking.
- Add a dependency only if necessary, and say why.

## Security (revisit before the real app)
- The asset protocol scope is currently `$HOME/**` and CSP is null, for the video spike only.
  Narrow the scope to user-selected course folders and set a proper CSP once the spike is done.
- Keep Tauri capabilities minimal. Ask before adding permissions.

## Working agreement
- One task at a time. Smallest change that works, no unrelated refactors.
- For non-trivial tasks, give a short plan first and wait for my "go".
- Ask before changing the data model, migrations, `tauri.conf.json`, or capabilities.
- Don't touch files outside this repo.
- Never commit. I review diffs myself.
- Don't change video playback or the asset protocol setup without telling me.


## Video playback
- WebKitGTK on Linux rejects Tauri's `asset:` scheme for media. Playback uses a localhost
  streaming server in `src-tauri` (127.0.0.1, random port, token per registered file or course
  folder, byte-range support). Don't switch back to `convertFileSrc` or the asset protocol.
- The server may only serve files inside registered course folders (canonicalize paths, reject
  symlink escapes and `..`).
- Ask before changing the playback server, its tokens, or `tauri.conf.json` CSP/capabilities.
- CSP is currently null. Set a real CSP (with `media-src` for the localhost server) before the
  real app ships.
