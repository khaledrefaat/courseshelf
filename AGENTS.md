# Courseshelf

Personal desktop app (Ubuntu) to track progress through local video courses (mostly mp4).
Tauri 2 + React + TypeScript + Tailwind v4 + shadcn/ui (Base UI) + SQLite (tauri-plugin-sql).
Package manager: pnpm. Use Tauri 2 APIs only; check the current docs when unsure, never v1 syntax.

## Commands
- Dev: `pnpm tauri dev`
- Typecheck: `pnpm typecheck` (frontend, Vite config and flashcard CLI)
- Lint: `pnpm lint` (Biome, repo-wide). Safe fixes: `pnpm lint:fix`
- Format: `pnpm format` (Biome, repo-wide formatting only)
- Tests: `pnpm test`
- Frontend gates: `pnpm check` (typecheck + lint + tests)
- Rust gates: `pnpm check:rust` (fmt check, clippy all targets with warnings denied, tests)
- Prepare subtitle helpers: `pnpm prepare:subtitles` (required before generation/release builds;
  builds both Whisper CPU variants; FFmpeg and the model download on first use)
- Release deb: `pnpm tauri build --bundles deb`
- Windows installer: manual `Windows installer` GitHub Actions workflow; see docs/windows.md.
  No local Windows toolchain is required for installation/testing. Windows runtime checks remain manual.
- Toolchain: Node version in .nvmrc, pnpm version in package.json's packageManager.
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
- Color roles: `primary` (near-black in light mode, cream in dark mode) for main buttons; `brand` (plum/pink) for progress bars,
  completion checks, active lesson, percentages and links; `brand-soft` for tinted backgrounds.
  `accent` is shadcn's hover surface, never use it as the brand color.
- Font: Inter, bundled via @fontsource-variable/inter. No CDN fonts.
- Follow the system light/dark preference, including changes while running. Theme and cover palette
  tokens live in src/index.css. Use player/player-foreground for media surfaces, not primary.
- Light mode uses white surfaces and neutral grays, with a solid plum header and white header text;
  dark mode uses warm charcoal surfaces with plum/pink accents. Header-contained inputs and buttons set their own foreground colors.
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
- Drag-and-drop for covers. Use the native file picker.
- Search beyond filtering the library by course title.
Build as custom components (not in shadcn): the circular progress ring in the course sidebar
and the folder-tree sidebar.


## Code style
- TypeScript strict, no `any`. Small components, hooks for logic.
- Zustand for global UI state. No Redux or other state libraries.
- Biome handles formatting and linting. Don't change `biome.json` without asking.
- Add a dependency only if necessary, and say why.

## Security
- Production CSP restricts scripts, styles and fonts to bundled assets, images to bundled assets
  and blob URLs, media to `http://127.0.0.1:*`, and connections to Tauri IPC. Other sources are denied.
- Keep script-src free of unsafe-inline and unsafe-eval, including development. Tauri's automatic
  CSP hashes/nonces stay enabled; Base UI receives a style nonce from the bundled HTML anchor.
  Inline style attributes are allowed for gradients and Base UI positioning. devCsp additionally
  permits Vite styles and localhost HMR; it is not the packaged-build policy.
- No asset protocol, broad home-directory grants, external-link opener or remote fonts/scripts.
  Folder access comes from persisted user-selected grants; cover writes stay in app data/covers.
- Register single-instance first, before database plugins. Release builds do not enable devtools.
- Windows alone starts hidden via its platform config. The mounted themed shell signals
  `frontend_ready`; a native five-second fallback reveals it if JS/IPC fails. Keep reveal
  idempotent so remounts/timeouts never reopen a minimized window. Do not wait for DB/root
  registration, change maximization, or add frontend show/focus permissions for this.
- Keep Tauri capabilities minimal. Ask before adding permissions.

## Working agreement
- One task at a time. Smallest change that works, no unrelated refactors.
- For non-trivial tasks, give a short plan first and wait for my "go".
- Ask before changing the data model, migrations, `tauri.conf.json`, or capabilities.
- Don't touch files outside this repo.
- Never commit. I review diffs myself.
- Don't change video playback or the asset protocol setup without telling me.


## Subtitles and generation
- Existing matching VTT/SRT sidecars take priority over generated caches. Invalid or
  unreadable existing sidecars produce a visible error, never automatic replacement.
- English generation uses bundled whisper.cpp and a pinned, downloaded FFmpeg executable from Rust,
  without a shell, uploads, frontend HTTP grants or arbitrary process arguments.
  Windows helpers use CREATE_NO_WINDOW. Never run helpers from PATH.
- Bundle only `resources/subtitle-helpers/whisper/`, never its legacy parent folder.
  FFmpeg downloads directly from a pinned upstream HTTPS release after explicit consent
  (~131 MiB Linux / ~163 MiB Windows). Verify archive size/SHA-256 and extracted binary
  size/SHA-256; extract only the expected regular binary and license into owned staging,
  then publish into app-data `tools/`. Reject archive links/traversal and cap extraction.
  Revalidate the installed binary before each generation; no network when it is valid.
  Missing/invalid tools need consent to download/repair. Keep progress, cancellation and
  interrupted-staging cleanup; no general frontend HTTP/process grants or CSP changes.
- `base.en` is already selected. Download it only after explicit consent; verify its
  pinned size/SHA-256 before installation and before each lesson's generation. Never
  bundle the model or silently skip integrity checks to improve speed.
- Bundle portable and AVX2 helpers. Select AVX2 only after checking every required CPU/OS
  feature, including MSVC scalar-instruction assumptions; otherwise use the portable
  helper. Keep machine-native compiler flags off. Use at most six CPU threads, capped
  by available parallelism, with no GPU. Changes to model/decoding defaults need approval.
- Metadata lives in `generated_subtitles` (migration 0005). Model, generated VTT cache
  and job audio/staging files live in app data (`models/`, `subtitles/`, `subtitle-jobs/`).
  Keep source fingerprints and lesson-owned filenames; changed videos invalidate caches.
  Generation must not play lessons or alter watched/completed/position/notes data.
- Single-lesson generation stays in app data. **Manage → Generate course subtitles…**
  runs non-missing lessons sequentially in course order, skips existing sidecars and
  reuses valid caches. One global reservation prevents competing single/course jobs.
  Keep the queue outside lesson components; navigation must not restart or cancel it.
- The course dialog defaults **Save subtitles beside videos** to checked; unchecking it
  keeps output in app data only. Export creates `<video-stem>.en.vtt`, retaining the cache.
  Use only the narrow Rust export command: derive the destination from a registered,
  persisted-grant lesson, reject symlinks/reparse points/traversal, and never overwrite.
- Export writes/syncs a unique sibling temporary file, then publishes it using an
  exclusive hard link. Keep this no-replace guarantee. Read-only/unsupported filesystems
  (e.g. exFAT) fail visibly while retaining cached subtitles. Remove only this operation's
  temporary file; report cleanup failures. No course-folder sweep or broad fs grants.
- Show current lesson/stage, counts, Cancel and per-lesson errors. Continue after
  individual failures; distinguish generation failures from export failures. Cancel
  matching queues on rescan/relocate/removal and drain in-flight exports before mutation.
  Cancel on close without extending the shared two-second close timeout. Queues are not
  persisted across restarts; rerunning skips/reuses completed work.
- Removing a course cleans its app-data caches best-effort, never exported sidecars or
  videos. DB backups contain metadata, not the model, cached files or exported sidecars.
  Keep private transcripts/models/tools in ignored local folders. See
  `docs/subtitle-generation.md` for limits, build/licensing details and manual checks.

## Video playback
- Matching VTT/SRT sidecars are read through `get_lesson_subtitle` inside registered,
  granted course folders, never through HTTP/asset URLs. Native text-track cues render
  basic timed text on Linux; Windows uses a pointer-transparent React caption layer
  driven by a hidden native track's active cues (18px normal, 22px fullscreen).
  Render only getCueAsHTML().textContent, never subtitle HTML. Clear on seek/error/end
  and lesson cleanup; keep Linux's native sizing/position unchanged. Windows native
  video fullscreen is promoted to wrapper/window fullscreen so sibling captions stay
  visible; retain cancellation, original-window restoration and the existing fallback.
  VTT styles/regions are not applied. Keep native controls, On/Off
  preference, bounded reads, no-links checks and lesson-change cancellation intact.
- Linux renderer default is set inline at the start of main, before threads or Tauri/GTK:
  WEBKIT_DISABLE_DMABUF_RENDERER=1 only if var_os reports it absent. Preserve any existing value.
  Keep the documented unsafe environment mutation here, never in setup or parallel tests.
- WebKitGTK on Linux rejects Tauri's `asset:` scheme for media. Playback uses a localhost
  streaming server in `src-tauri` (127.0.0.1, random port, session token per app launch,
  registered course roots, byte-range support). Don't switch back to `convertFileSrc` or the asset protocol.
- The server may only serve files inside registered course folders (canonicalize paths, reject
  symlink escapes and `..`).
- Session tokens use getrandom's OS-backed secure randomness on Linux and Windows (32 bytes).
  Keep token strength, loopback binding, Host checks and lack of permissive CORS unchanged.
- Windows scanner/playback reject internal reparse points (including junctions); do not follow them.
- Ask before changing the playback server, its tokens, or `tauri.conf.json` CSP/capabilities.
- Production uses `tauri://localhost` on Linux. Media requests must retain the exact loopback
  Host check, token validation and absence of permissive CORS headers. Native video loads use
  no-CORS mode; do not add crossOrigin to the video element without reviewing the server.
- Course-page shortcuts ignore editing/IME, modifiers and menus/dialogs. Native controls stay
  enabled; handled Space is consumed through keyup/keyboard-click activation to avoid double toggles.
- Do not add canvas-based seek-frame retention without a successful real WebKitGTK check.
  The previous attempt produced noise/white frames and was removed; fake-media tests did not catch it.
- Fullscreen tries the stable player wrapper first. Window fallback uses only the approved
  `core:window:allow-set-fullscreen` and `core:window:allow-is-fullscreen`, records/restores the
  original fullscreen state on exit/unmount, and never resizes or changes maximization.
  On Linux, the approved read-only `actual_window_fullscreen` command reads GDK state;
  Tao's cached isFullscreen flag alone is not reliable after OS-triggered fullscreen exits.
  The main window starts maximized, not true fullscreen. Keyboard seeking waits for the
  tracking controller's resume-ready state and uses normal media events, never synthetic ended.


- Rescanning never deletes progress or notes. Lessons whose files disappeared are marked
  `missing_at`, not deleted. Abort the sync (write nothing) if the root is unreadable or the
  scan finds zero videos while lessons exist.


## Scanning and sync
- Scanning is a strict Rust walker (`course_scanner.rs`) feeding a pure parser in
  `src/lib/scanner`. Video types: mp4, m4v, webm. Everything else is ignored but counted.
- Folder grants come from the dialog plugin and persist via tauri-plugin-persisted-scope.
  A missing grant returns `FOLDER_NOT_AUTHORIZED`; the UI must ask the user to re-pick.
- Sync never deletes lessons: files that disappear get `missing_at` and keep progress and notes.
  Counts and lists exclude missing lessons. Abort writing nothing if the root is unreadable
  or zero videos are found while lessons exist.

## Progress tracking
- Lesson durations are cached separately from progress. Background metadata reads use the existing
  playback server, never play or mark a lesson watched, and run at most two at a time on the course page.
  Successful rescans invalidate cached durations; unknown/partial section totals show a dash.
- Library cards aggregate the same lesson duration cache in their summary query; no separate
  course-duration table or migration. Show a total only when all non-missing lessons have valid
  durations, otherwise a dash. The currently filtered grid fills only uncached metadata, one
  course at a time and at most two reads across the grid (not per card), after initial paint.
  Skip unregistered roots; abort on navigation/filter changes, hidden document and management.
  Cached-total updates must not restart discovery or loop on unavailable media. Reuse revision-
  guarded duration saves so rescan/relocation rejects stale reads; never touch progress/notes.
- Position saves are throttled (5s, 1s minimum change) and serialized per lesson. Never save a
  position before the resume seek is confirmed. Saves never touch `completed`.
- Auto-complete at 90% while playing, or on ended. Undo suppresses re-completion for that visit.
- On genuine played ended only, ready saved flashcards open review instead of a countdown.
  Escape closes review and stays on the ended lesson; review never navigates lessons.
  No auto-generation, late auto-open after generation/loading, or opening at 90%/manual completion.
  Without ready cards, auto-advance to the next available lesson after a five-second countdown.
  Cancel (S) follows the usual shortcut guards. Flush pending writes before navigating; cancel
  on replay/seeking, page exit, hidden document or course management. No advance after the final lesson.
- Window close flushes pending writes with a 2s timeout and always closes anyway.
- Anything with pending writes (progress, notes) registers with the shared flush mechanism so the
  Library re-query and the close handler wait for it.


## File safety
- Never delete, move, rename or modify existing files inside a course folder.
  The explicit exception is the approved subtitle export: create a new .en.vtt
  beside a registered/granted lesson using a unique temporary file and no-replace
  publication. Clean only that export's own temporary file; never overwrite sidecars.
  All other writes stay in app data. Removing a course removes database rows and
  owned app-data files, never videos or exported sidecars. See docs/subtitle-generation.md.
- Cover loading and cleanup share the scoped path resolver in src/lib/cover-paths.ts.
  Support native Windows separators without weakening traversal/outside-path checks;
  cleanup still requires the exact course-owned UUID filename.


## Keyboard shortcuts
- One handler on the Course page. It ignores editable elements, IME composition, modifier keys,
  open dialogs and menus, and tab/menu/listbox roles. Seeks go through the normal media events so
  position saving and auto-complete keep working. New shortcuts follow the same guards.
- Fullscreen tries the wrapper element first, then the Tauri window fallback, and always restores
  the original window state (maximized at startup).

## Lesson flashcards (Tauri, unreleased)
- Single lessons and an explicit Manage → Generate course flashcards queue. Reuse the pure shared rules in
  src/lib/flashcards (the CLI trial re-exports core.ts). Native video, subtitle
  transcription, progress and notes contracts remain unchanged.
- Generation is explicit and sends transcript text to the fixed Z.ai HTTPS endpoint
  using glm-5.3-flash. Do not auto-generate on ended, automatically retry paid requests, change the
  model, or claim provider token counts equal package billing. No frontend HTTP
  grant, CSP change, SDK or model download. Rust disables redirects and retries,
  limits request/response sizes and time, and strips provider envelopes/reasoning.
- API keys go through the password dialog to Rust session memory; never save them
  in SQLite/localStorage/checkpoints/logs or ship a shared key. Forget/close cancels
  matching work. Do not make live paid requests during tests without permission.
- Source reads reuse registered/persisted-grant, bounded VTT/SRT/generated-cache
  checks. Sidecars take priority; invalid sidecars cannot silently fall back. Source
  SHA-256 binds checkpoints; a cheap video size/mtime fingerprint detects ordinary
  changes (not video integrity). Generated-cache reads keep their full video SHA check.
- Migration 0006 adds flashcard_sets/flashcards; 0007 expands only extra_context
  to 1,200 characters by rebuilding the child table transactionally. Preserve IDs,
  edits, evidence, empty sets, timestamps, atomic publication triggers and cascades.
  Never edit an applied migration. All SQL stays in src/lib/db.
  Publish via one conditional SQL statement and staging-column triggers, not pooled
  BEGIN/COMMIT calls. Failure preserves the previous set. Edits bind generation IDs.
  Writes use the shared per-lesson serialization/close drain; course removal blocks
  and drains work before cascade. No late response may recreate removed data.
- One module-level job survives lesson navigation, but cancels for close and course
  rescan/relocation/removal. Keep the existing two-second close deadline. Successful
  cards/evidence live in SQLite and backups. Private bounded flashcard-jobs/ app-data
  checkpoints exclude keys and video, and use only known lesson-owned files/no links.
  Resume revalidates received responses before new API calls. Uncertain in-flight
  requests require explicit discard/start-over; never silently resend them.
- Course preview separates received-but-invalid responses from blocked checkpoints.
  Retry failed lessons only is explicit, separately confirmed upload/credit scope, never
  automatic. Revalidate the entire checkpoint identity/source/version and response hashes;
  reuse only the contiguous semantically validated prefix before the first failed stage.
  Re-run that stage and dependent suffix within the new confirmed ceiling. Never relax cue
  or schema validation. Started/uncertain, corrupt, changed-source and old-version work
  remains blocked for individual attention. No saved set (including edits/empty sets) is replaced.
  Native recovery preserves the root checkpoint, stages in two bounded no-link retry slots,
  and publishes an exact-slot pointer last; failed staging leaves the active work unchanged.
  Repeated explicit recoveries alternate slots. Cleanup/discard validates all known content
  before deletion; successful publication clears root and slots. Retain cancellation,
  close deadlines and separate new/reused/excluded-earlier token accounting; unknown is not zero.
- Course batches have read-only cancellable preflight, explicit transcript-upload/credit
  consent and a confirmed ceiling on NEW requests. Hold only one source at a time;
  keep metadata, not transcripts/replies/native preparation IDs, in the course plan.
  Reprepare immediately before each lesson (native preparation cache holds eight IDs),
  compare source/identity/checkpoint with the preview and never expand its upload scope.
  Keep one frontend reservation across the entire batch, including gaps between lessons.
  Saved sets (including zero-card/deleted-card sets and edits) are skipped; publication
  uses atomic ON CONFLICT DO NOTHING, never the single-lesson replacement path.
  No automatic transcription, checkpoint discard, retry or persistent queue/restart spending.
  Reuse only compatible fully received stages validated before any paid call. Native
  begin/request rejection or finalization failure stops the batch conservatively;
  lesson-local source/response-validation errors are reported without retry and can continue.
  Track new/reused reported tokens separately, including received invalid responses;
  unknown/interrupted usage is never presented as zero. Navigation never cancels a batch;
  Forget/replacing an active key, management and close synchronously invalidate queued
  work and drain it with the current job. Close still has the same two-second deadline.
- Preserve count/text/cue limits, references copied locally, context qualifiers,
  whole-lesson deduplication/coverage warnings and a varied first-five review.
  Schema/reference checks are not fact-checking. Added context is labeled separately;
  never invent unseen slides or imply web verification. Manual edits retain original
  evidence and are visibly marked. Regeneration warns that it replaces manual edits.
- Prompt 8 teaches self-contained named concepts with plain-English causal explanations,
  not instructor-specific code/workflow trivia or vague references. Avoid attribution
  boilerplate ("according to this course/instructor") while keeping actual tool/version/
  scenario conditions and trade-offs. Actively use labeled AI context for missing foundations,
  mechanisms and simple in-scope examples (target 2–4 short sentences, hard cap 1,200).
  No new syllabus, invented slide contents or unsupported additions to the lesson answer.
  Validator 7 expands only that text bound; cue/reference checks remain strict. Selection
  sees a labeled, capped 480-character context preview within the same 65k message bound;
  it selects existing IDs and never rewrites cards. No extra API stage or token-cap increase.
  Extraction sends cueId/text and allowed global
  IDs only; times stay local. Reject bad references, never remap seconds or silently retry.
  Existing cards/edits stay unchanged; native older-prompt checkpoints need explicit discard,
  not silent upgrade/replay. The CLI retains validated older-response provenance on resume.
- Review is an existing-component dialog, not a new player. Render ONE normal-orientation
  question/answer face; fold using positive 2D scales and swap text at the midpoint.
  Do not restore stacked rotateY/backfaces: they painted mirrored text in the user's native app.
  Chromium-only preview checks do not establish real WebKitGTK rendering acceptance.
  Cancel flip timers on card/page cleanup; keep keyboard activation and reduced motion.
  The popup frame is transparent; review tokens provide white surfaces, dark text and plum accents in both
  themes. Regular Previous card / Next card floating buttons sit below the card,
  with Details between them (below on narrow screens). No side arrows, Hide/Done,
  Next lesson or visible flip hint; Escape still closes the review. Disable navigation
  at the first/last card and during writes. The front contains only the question; the back shows the answer
  and optional labeled AI-added context. Lesson evidence and editing stay in Details.
  Long content stays bounded.
  Real ended chooses review/countdown once, with cancellation guards through fullscreen exit.
  Closing review never restarts a timer; replay can reset the end. Clicking manual Review cancels
  the countdown synchronously, awaits existing fullscreen exit, then opens only for
  the same lesson. Do not play/pause/seek/change completion. Keep Next and Cancel (S)
  for lessons without cards; review navigates cards only, not lessons.
  See docs/flashcards.md for limits, failure handling and acceptance checks.
