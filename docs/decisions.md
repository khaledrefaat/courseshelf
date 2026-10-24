# Decision context for future work

This is a concise handoff, not a chat transcript or a substitute for checking the
current code. Read [AGENTS.md](../AGENTS.md) first for working contracts. Preserve
those contracts unless the user explicitly approves changing them. Update the
relevant entry when a decision changes; do not accumulate competing instructions.

## Product and active implementation

Courseshelf is a personal library for existing offline course videos, built to make
progress, completed lessons and saved positions visible like a learning platform.
Sharing installers with friends is supported, but account systems, course hosting
and cloud video uploads are not the purpose of the app.

`main` is Tauri. An Electron experiment gave the maintainer smooth scrolling and
seeking on their Linux machine, but was deliberately parked on the `electron`
branch and removed from `main`. Do not reintroduce its dependencies or migrate
frameworks as an incidental fix. Ask before resuming that work; verify branch
availability rather than assuming an old experiment exists in every clone.

Published installers and current source are different states: flashcards and
Library duration totals are documented as unreleased source features, even while
the source version remains 0.3.1. Never infer an installer's feature set from the
version string alone or change download/release claims without verification.

## Linux rendering: a real trade-off, not an established CSS fix

On the maintainer's Wayland system, allowing WebKit's DMABUF renderer made scrolling
smooth but produced blank frames after seeking. Disabling it made seeking work but
scrolling laggy. Forcing shared-memory rendering and testing a newer WebKitGTK runtime
did not establish a combination that fixed both. Lag was also observed in the
Library and with video hidden, so it was not isolated to the player or sidebar.
These are observations on that setup, not a diagnosis for every Linux machine.
The user does not want X11 as the workaround.

The current safety choice is `WEBKIT_DISABLE_DMABUF_RENDERER=1` on Linux only when
the environment variable is absent. Preserve overrides. Mutation stays at the
start of `main`, before threads/Tauri/GTK; Rust 2024 requires an unsafe block with
this ordering documented. Never move it into setup or parallel tests.

Canvas-based seek-frame retention was tried and removed after real WebKitGTK
produced noise/white frames; simulated media tests missed it. Custom controls or
another CSS pass are not evidence of a compositor fix. Reproduce and compare
scrolling, paused/playing video, repeated seeks and native fullscreen before
claiming a rendering change solves the problem. Keep localhost streaming, native
controls, token/Host checks and CSP intact.

Wheel volume is limited to hovering over the fullscreen player, using the existing
fullscreen controller for wrapper, native and window fallback modes. Outside
fullscreen, wheel events remain untouched so the course page scrolls normally. The
video surface suppresses its focus outline while retaining focus and keyboard
operation; other controls retain their focus indicators.

See [renderer overrides](release.md#player-keyboard-and-fullscreen-checks). Platform
tests must be identified explicitly: a browser test is not native WebKitGTK or
Windows WebView2 acceptance.

## Subtitle generation: normalize generated defects, not user files

Whisper once emitted a zero-duration cue containing spoken text. The strict parser
correctly rejected it. The fix merges only newly generated staging fragments into
an adjacent positive-duration cue sharing the exact boundary, preserving words and
valid timestamps. It never invents timing or rewrites existing sidecars/caches.
Reversed or unanchored invalid cues still fail visibly.

FFmpeg and `base.en` download only with consent, keeping installers smaller. Their
integrity checks are deliberate; do not skip them to accelerate course batches.
Helpers stay bundled, CPU-only and bounded. SQLite holds subtitle metadata; cache,
models and tools live in app data. Optional beside-video exports never overwrite.
See [subtitle generation](subtitle-generation.md) for storage, timing and export rules.

## Flashcards: learning concepts, with explicit paid recovery

The goal is to understand named concepts, definitions, mechanisms and useful
applications, not memorize demo filenames, clicks or the instructor's wording.
Missing foundations and small in-scope examples belong in separately labeled
AI-added context. That context is not independently verified and must not invent
unseen slide contents or expand into a new syllabus. Answers retain lesson evidence;
schema checks are not fact-checking. Card counts depend on lesson substance and
length, not a fixed seven-card quota.

Two observed provider failures explain the current boundaries:

- Numeric evidence such as `[189,190]` is an equivalent shape to
  `[{"cueId":189},{"cueId":190}]`. The in-app pipeline wraps safe integers in memory
  before strict validation and records the count in generation notes. It never
  coerces strings, remaps IDs, drops bad entries or rewrites raw checkpoints/hashes.
  The core validator and CLI still require cue objects.
- A reply ended with `finishReason: "length"`, exhausted 8,192 output tokens and
  contained roughly 38,000 whitespace characters outside strings, leaving unfinished
  JSON. Prompt 9 asks for compact single-line JSON, no padding, brief notes and an
  immediate stop. The model, decoding, validator 7 and token cap did not change.
  This is risk reduction, not a guarantee. Never salvage truncated JSON or accept
  a length-limited response even if it appears parseable.

Keep native and TypeScript prompt-version constants aligned. A native version
change needs a rebuilt/restarted app, not just frontend HMR. Native older-prompt
checkpoints require explicit discard/start-over; the CLI can retain compatible
older-response provenance after validation. Do not silently upgrade or erase paid
work, retry requests, raise budgets or make live API calls during tests. Saved sets
and edits survive failures. See [flashcards](flashcards.md) for recovery/usage rules.

## Review dismissal depends on how it opened

Ready saved cards open only at a genuine played end, replacing the countdown.
Closing that automatic review (including Escape) flushes progress/notes and advances
once to the next available lesson, with no new countdown. Closing manual review
stays put; the final lesson stays put. Previous/Next card only move within the set.
Management/cleanup/unmount is not an explicit dismissal. Replay, source/target
changes, hidden pages, errors and navigation invalidate stale close callbacks,
including while saves are pending; a failed save prevents advancement.

Notify dismissal after the dialog leaves the DOM so existing popup guards still
work. Do not remove those guards to make navigation succeed. The controller and
shared write-drain tests cover the state machine, but real native focus/fullscreen
behavior still needs manual verification.

The single visible card face with positive 2D-scale animation is intentional:
stacked `rotateY` backfaces painted mirrored English in the native app. Review
surfaces follow the system theme to match the surrounding app: white with dark
text/plum accents in light mode, charcoal with cream text/pink accents in dark mode.
Shared review tokens keep cards, controls and Details consistent. Evidence
and editing stay in Details; useful labeled AI context stays on the answer face.

## Disk space, privacy and verification

Rust build caches have repeatedly consumed several GiB, so the maintainer deliberately
cleans them between builds. Do not recreate them for docs or frontend-only tasks.
`pnpm tauri dev`, native release builds, Clippy and Rust tests can compile and refill
the cache. Subtitle-helper preparation can also build/download tools. Warn before
rebuilding a cleaned native cache; never install dependencies/toolchains when the
user requests a no-install task.

An approved cleanup first checks the exact target directory and active builds,
preserves installers in ignored `release-artifacts.local/`, verifies copies and
cleans only build artifacts. An installed app is not removed by cleaning artifacts;
the next native build must recreate them. Shared Cargo downloads, Rust toolchains,
app databases/WAL, covers, models/tools, checkpoints and course files are not the
same cache and must not be swept together.

Ignored `*.local` experiment/release folders are optional private local material,
not runtime dependencies or tracked project documentation. Do not copy transcripts,
API keys, full provider responses or private course paths into tracked docs/tests.
Use synthetic fixtures; keep real-data diagnostics read-only and paid calls explicit.

For documentation-only tasks, inspect diffs and local Markdown targets without
installing or building anything. For frontend changes use installed frontend gates.
For native changes run native gates when authorized, or clearly report them deferred.
Distinguish typecheck/unit/build success from real WebKitGTK/Windows checks, and
never present an older chat's successful test run as verification of current edits.
