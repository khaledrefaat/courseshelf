# Lesson flashcards

This is an **unreleased Tauri source feature**, not part of the linked 0.3.1
installers. No release/version bump is included.

## Use

The course page has a Flashcards panel above notes. Generate uses an existing
matching VTT/SRT or a valid app-data generated transcript. Missing transcripts
require you to use the existing subtitle-generation flow first. Invalid sidecars
produce an error, not silent replacement or fallback to a different transcript.

Enter a Z.ai API key in the password dialog and confirm generation. The key is
held in native session memory, not persisted. You must enter it again after app
restart; Forget key clears it and cancels active native work. Keys transiently
pass through the password field/IPC; this is not a secure-memory-zeroization or
protection-against-a-compromised-renderer guarantee. Never paste keys into issues.

The confirmation describes the transcript and a maximum request count. No account
or key is required to read saved cards. Review shows one card at a time with a
question first; click it or press Enter/Space on the focused card to flip it.
Previous/Next card step through the entire saved set, starting each on its question.
The card is white with dark text and plum accents in both themes, without an outer panel. It contains
only the question on the front; the back shows the answer and any saved AI-added
context, labeled "AI-added context · Not independently verified". Regular **Previous card**
and **Next card** floating buttons sit below the card, with **Details** between them
(below them on narrow screens). Navigation is disabled at the first/last card.
There are no side-arrow, Hide/Done or Next lesson buttons and no visible flip hint.
Escape closes the review. Open Details for lesson evidence and editing, including
the optional context text.
The animation respects reduced motion; long answers scroll within the card. Excerpts
and timestamps can be expanded. Edits/deletions are local; edited answers retain
the original evidence and are marked as edited. Successful regeneration replaces
these changes only after the new set is fully validated and saved.

At a genuine played lesson's end, available saved cards open automatically instead
of starting the five-second countdown. The existing fullscreen restoration finishes
before review opens. Explicitly closing this automatic review (including Escape)
flushes pending progress and notes, then advances once to the next available lesson
without another countdown. After the final lesson it stays put. A failed save keeps
the current lesson and shows an error. Closing a manually opened review always stays
on the current lesson. Cleanup, page exit and management closing the dialog never
advance; replay/seek, errors, hiding the page, target changes or navigation cancel
pending automatic advancement, including during saves.
Replay followed by another end can open review again; rerenders,
90% completion, manual completion and later generation/card loading do not open it.
Hidden pages, seeking/errors, management and open dialogs/menus block automatic review.
Lessons without ready saved cards keep the five-second countdown and Cancel (S).
Manual Review cards still cancels an existing countdown immediately, even during
its write flush. No generation,
pause, play, seek or completion change is triggered by review or generation.

## Whole-course generation

Choose **Manage → Generate course flashcards…** in the course page. A read-only
preview checks lessons sequentially and shows ready lessons, saved sets and issues.
Cancelling/closing the dialog stops further preview reads after the current bounded
read finishes; it sends no paid requests. Only source/checkpoint metadata is retained
for the course, not all transcripts/responses. One lesson is reprepared immediately
before generation, so large courses do not rely on expired native preparation IDs.

Saved sets are skipped, even if empty or all cards were manually deleted. Edits are
kept. Changed sources are flagged when readable, but batch generation never replaces
old sets: regenerate them individually if desired. Missing/invalid transcripts and
uncertain/outdated/corrupt checkpoints are listed and skipped. This never chains
subtitle generation. Run course subtitles first if needed.

**Recover failed lessons:** a received AI response that fails schema, evidence,
model or completion checks is shown as **failed, retry available**, not ready.
Select **Retry failed lessons only**, review the per-lesson reasons, retained response
counts and maximum new requests, then confirm transcript uploads/credit use again and
enter your session key. Click **Retry failed lessons**. This processes only those
recoverable failures, not other ready lessons or saved sets.

Recovery retains the contiguous validated sections before the first failure and
regenerates that stage and dependent later stages. A failed final selection reuses
all valid extraction sections. No cue IDs are coerced, remapped or ignored to make invalid
output pass. Original root checkpoints remain until successful publication or an
explicit discard; staged retries use two bounded alternating owned slots and an
atomic active-slot pointer. A failed/cancelled retry never triggers another retry.
Use Refresh preview to inspect it and explicitly confirm any further attempt.
Changed sources, unknown request outcomes, older versions and corrupt checkpoint
files remain blocked for individual attention—this flow never silently starts over.
The disabled action now explains whether preview, eligible lessons, consent, a key
or completion/cancellation of another job is needed.

Confirm the eligible transcript uploads, use of credits and reuse of compatible
received work. The displayed maximum NEW request count is a conservative bound,
not an exact token/price estimate. Each request retains the 8,192-output-token cap.
Each lesson is bound to its previewed identity, source and checkpoint. Changed
items are reported without upload; newly added lessons are not included. Requests
cannot exceed the confirmed per-lesson/course bounds. No paid automatic retries.

One reservation covers the whole queue, including gaps between sequential lessons;
single-lesson generation and another batch cannot compete. Navigation/dismissing the
dialog does not cancel accepted work. The global status shows lesson/stage, generated,
resumed, skipped and failed counts, new requests and separately reported new/reused
tokens. Usage from received but semantically invalid replies still counts. Requests
without reported usage remain unknown, not zero; verify charges in the provider dashboard.

Lesson-local source/validation failures can continue. Every native begin/request
rejection conservatively stops the batch, including authentication/quota/rate-limit,
network/service failures and uncertain native failures. Finalization failure also
stops it; successfully saved sets remain saved. No provider-body parsing or automatic
backoff/retry is introduced. Issues show the latest 50 messages, with total failure counts.

Cancel stops queued work synchronously and drains the current operation. Forget key,
replacement while running, Rescan/Locate/removal and close do the same; a preview made
before those events must be refreshed. Closing retains the existing two-second deadline.
An in-flight upstream call can still cost credits. Partial successes remain saved.

The queue is not persisted or auto-resumed on restart. Preview again: completed
sets are skipped, and compatible validated received stages can be reused after
confirmation. Uncertain work requires the existing individual lesson checkpoint controls.
Batch saves use a conditional insert with ON CONFLICT DO NOTHING in the existing
write queue: a concurrent saved set is never overwritten. No new migration, model,
dependency, course-folder export, player behavior or permissions are introduced.

## What leaves your computer

Only an explicit generation/resume sends plain-text transcript cues with cue-ID labels,
and (when selecting across sections) candidate questions/answers, to the fixed
`https://api.z.ai/api/paas/v4/chat/completions` endpoint with `glm-5.3-flash`.
Video, notes, covers and app-managed folder paths are not sent. A transcript can
itself contain personal information, paths or instructor examples: inspect what
you choose to upload. This is optional cloud generation, unlike offline Whisper
transcription. Your provider account's terms/data policies apply.

Rust owns the key and authenticated transport. It accepts bounded job/stage
operations, not arbitrary URLs. Requests use HTTPS, certificate verification,
no redirects and no retries. Production frontend CSP/capabilities do not change.
Only message content and numeric usage are checkpointed, not response headers,
reasoning or full provider envelopes; any echoed session credential is redacted.
See [Z.ai Chat Completion](https://docs.z.ai/api-reference/llm/chat-completion).

## Limits and quality

The app and standalone trial share parsing/prompts/validation. Inputs are bounded
to 2 MiB/10,000 cues and at most eight sections. A section preserves complete cues,
with at most 15 minutes or roughly 22,000 serialized characters. A dense lesson
can reach the section limit before two hours; oversized inputs stop locally.
Each request has at most 65,000 serialized message characters, an 8,192-output-token
budget, a three-minute total timeout and a 1 MiB response limit. Extraction is
sequential, with at most one final selection request (nine requests overall).

Suggested whole-lesson counts are 3–7 up to 15 minutes, 5–12 up to 30 minutes and
10–25 above that. These are not minimums. Promotional/introductory material can
produce zero. Candidate counts and evidence bounds match the CLI trial; a valid
surplus is selected down, not silently dropped. All returned references are
checked before duplicate IDs are normalized, and original quotes/times are copied
locally. Timestamps stay local; the model sees only cueId/text entries and the
allowed global IDs for that section. Out-of-section IDs are rejected, never guessed
or converted from seconds. Coverage gaps and abbreviated selection previews are shown in notes.

The in-app response boundary accepts the provider's equivalent numeric evidence
shape (`[189, 190]`) by losslessly wrapping safe integers as
`[{"cueId":189}, {"cueId":190}]` before strict validation. Every ID must still belong
to that section; strings, invalid entries, extra fields and count limits remain
strict. This applies to fresh and cached responses, with the conversion count
recorded in generation notes. Raw checkpoint responses and hashes remain unchanged;
no API retry is sent to repair this shape. The core validator and CLI remain strict,
and this shape adapter alone does not change prompt/validator versions.

Prompt version 9 retains the concept-focused guidance: name one concept in each self-contained
question, explain it in plain English, unpack essential jargon and give causal
explanations instead of vague references or lists. Definitions, mechanisms, distinctions,
when/why to use something and misconceptions take priority over demo names/workflow trivia.
Avoid "according to this course/instructor" and similar repetitive attribution, but
retain meaningful tool/version/scenario conditions and recommendations as trade-offs,
not universal facts. This is generation guidance, not a text replacement applied to saved cards.

The answer remains supported by the cited transcript. AI-added context should actively
help when an explanation is incomplete: supply a missing definition, minimal prerequisite,
mechanism, distinction, analogy or simple invented illustrative example of that same
concept. It is not a reconstruction of the instructor's demo or unseen slide. A concept
clearly identified in teaching may receive background clarification; an unrelated
name-drop/promotion does not establish a new topic. Unidentifiable visual references
still warrant skipping, not guessing. No new syllabus, tangents or invented sources.

Context targets 2–4 short sentences when useful, with a **1,200-character** hard limit;
shorter/null is appropriate when no clarification is needed. Validator 7 and the editor
share this bound; question/answer/evidence/count limits are unchanged. No web lookup or
independent fact-check is added. Richer text can use more tokens/time within the same
8,192-output-token limit; incomplete output still stops without a paid automatic retry.
Prompt 9 additionally requests compact single-line JSON, no padding/leading/trailing
whitespace, an immediate stop after the final brace, and notes of at most 300
characters (guidance only; the strict validator still allows 2,000). It favors fewer
complete cards over running out of output space, without removing useful AI context
or qualifications. Both extraction and selection use this guidance. A provider
`length` finish reason shows **Provider output limit reached (8,192 tokens)** and
rejects the entire response, even if its JSON appears complete. Other incomplete
finish reasons remain errors. This reduces avoidable output waste but cannot
guarantee the provider will comply; no limit increase, partial-JSON repair, automatic
retry or additional API stage is introduced.

Whole-lesson selection sees up to 480 characters of explicitly unverified AI context
per candidate, so it can judge combined learning value rather than only terse answers.
All question/answer/context previews are further abbreviated if necessary to fit the
same 65,000-character serialized message limit, with abbreviation flagged. Full saved
cards remain unchanged; selection returns candidate IDs, not rewrites. There is no
additional generation stage/request. Existing sets/edits are never rewritten by a
prompt update; explicitly regenerate individual lessons to use the new guidance.
Course batches continue to skip existing sets.

Checks establish structure and valid cue references, **not logical support,
truth, topic completeness or educational quality**. Review context qualifiers and
source excerpts yourself. Extra context is labeled AI-added and not
independently verified. There is no web research or slide/image access. The
editorially improved 23-card trial sample is not proof of automatic model quality;
the revised prompts still need manual acceptance on real lessons.

## Failure, cancellation and resume

One global job/batch lives outside lesson components. Navigation does not restart or
cancel it; a small global status strip offers Cancel. Close cancels it without
extending the shared two-second write-flush deadline. An upstream request may
still consume credits after local cancellation, timeout or an HTTP error.

Received responses are checkpointed before semantic validation. On failure, the
old saved set remains available. Reopen Generate to inspect/resume received work:
the app checks source hash, video fingerprint, exact cue sections, versions and
response hashes, then validates **all** cached content before any new paid call.
The separately confirmed course recovery flow above may exclude an invalid suffix;
only the retained prefix is used as input to new generation, with the native side
checking the exact confirmed manifest again before switching recovery slots.
Malformed content is not silently repaired. A request recorded as started without
a fully recorded response has uncertain usage and cannot be automatically resumed.
You can explicitly discard/start over (which may repeat charges), or discard the
checkpoint without generating anything. CLI trial outputs are not auto-imported.
Native checkpoints from an older prompt version remain on disk but cannot be resumed
under prompt 9/validator 7 (including prompt 8 checkpoints): discard/start over is
explicit and may incur charges again. Existing saved cards and edits remain unchanged. The CLI
can still reuse compatible older responses after validation and records their original
prompt versions; reused content is not retroactively made concept-focused.

Reported tokens for new requests are separate from reused-request usage. During
recovery, earlier received responses excluded from reuse have a separate reported
token/unknown-usage count; those requests may already have cost credits. Missing
usage is unknown, not zero. These counts are not a currency or package-billing
estimate; check the provider dashboard. Cancel before the final commit keeps the
previous set; once the atomic SQL commit succeeded, cancellation cannot undo it.

## Storage, backups and lifecycle

Migration `0006_flashcards.sql` adds `flashcard_sets` and `flashcards` to the
existing database. `0007_flashcard_context.sql` transactionally rebuilds only the
child card table to expand extra_context from 500 to 1,200 characters, preserving
row IDs, edits, evidence, empty sets and set metadata, then restores publication
triggers/cascades. Back up before first launch. Applied migrations are unchanged.
One conditional statement plus SQLite triggers replaces all cards atomically;
the transient transfer payload is cleared inside that transaction. This avoids
unsafe multi-call transactions across the SQL plugin's pooled connections.
Edits and generation share the existing per-lesson write queue/close drain.

Complete sets, edits, source fingerprints, excerpts and usage are inside database
backups. Your API key is never included. Partial responses/manifests live only in
app-data `flashcard-jobs/<course-id>-<lesson-id>/`; Unix directories/files use
0700/0600. They are private course excerpts and should not be shared casually.
Each lesson retains at most nine bounded responses plus a manifest, not a full
video/transcript copy. Successful saving clears these files. A failure retains
them for inspection/resume; use Discard checkpoint to free them. Multiple lessons
can accumulate partial checkpoints; there is no global automatic sweep.

The exact transcript SHA-256 and video size/mtime fingerprint are checked when
preparing and before committing. The latter is cheap ordinary-change detection,
not a cryptographic video integrity guarantee. Existing generated-cache reads
still use their original full video SHA-256 checks. Changes flag cards as possibly
outdated when the page/source is checked; existing saved cards stay stored.
No file watching or automatic regeneration is performed. If the source is
unavailable, source checking/generation may fail but saved cards remain readable
while the lesson is still listed. A rescan marking the lesson missing also hides
it from the normal course outline; locating/restoring it restores that entry.

Rescan/Locate cancel and drain matching work first; lesson IDs and cards survive.
Removal blocks jobs/writes, drains active work and deletes via foreign-key cascade,
then cleans only owned app-data checkpoints best-effort. Failed cleanup may leave
private orphaned checkpoints and produces a warning. Videos/sidecars are untouched.
See [backup/restore](backup-and-restore.md). Older backups simply have no cards;
relaunch applies missing migrations through 0007. Do not manually alter migration history to downgrade.

## Acceptance checks

Automated tests mock the provider; they do not use a real key or credits. Run:

```sh
pnpm typecheck
pnpm exec tsc -p scripts/flashcards/tsconfig.json
pnpm lint
pnpm test
pnpm check:rust
pnpm build
```

Back up and quit the installed app before `pnpm tauri dev` (same app identity/data).
For an explicitly approved paid manual test:

1. Open an English lesson with a valid sidecar, enter a private key and generate.
   Confirm counts/stage progress, excerpts, useful/qualified answers and token report.
2. Navigate away/back while running. Cancel and inspect the checkpoint; never assume
   cancellation means no charge. Resume received work or explicitly start over.
3. Flip with mouse and Enter/Space; navigate cards, inspect context/evidence, edit/delete
   one, restart and review offline without
   entering a key. Generate on a lesson with no transcript: it must explain the prerequisite.
4. End a lesson with saved cards: review opens once with no countdown. Escape
   must flush progress/notes and advance once, without another timer; after the final
   lesson it stays put. Manually open Review cards and close it: stay on that lesson.
   Navigation, replay/seek, hidden page, errors or management while review is open or
   saves are pending must prevent stale advancement. A failed save must show an error
   and stay put. Previous/Next card must navigate cards only; first/last
   navigation is disabled and no lesson-navigation/Hide buttons or flip hint appear. Test
   the final lesson, replay, long answers, reduced motion and both themes. Without
   cards the old countdown/Cancel (S) must still work; manual Review cancels even
   an already-flushing countdown. Loading/generating cards after ended must not auto-open.
5. In real WebKitGTK, check initial question, repeated flipping and side-arrow changes:
   text must stay normally oriented, without a mirrored/overlapping reverse face. The
   animation uses one rendered face with positive-scale folds, not CSS 3D backfaces.
   Test wrapper/window fullscreen restoration, f/double-click/native controls and
   keyboard guards while dialogs are open, on both Ubuntu and Windows.
6. Regenerate unsuccessfully: old edits/cards must remain. Change a transcript and
   revisit: show outdated status. Rescan/Locate/remove while running: no late writes.
7. Export a database backup, verify integrity/foreign keys and flashcard row counts,
   then restore into a disposable copy and check cards/edits/excerpts. No key should exist.
8. Preview a course with saved/edited/empty sets, valid transcripts and missing/invalid
   ones. Cancel preview: no API calls or saved changes. Refresh/confirm only after
   reviewing the eligible uploads, checkpoint reuse and request ceiling.
9. Start an explicitly approved small paid batch. Navigate between Library/lessons:
   status must persist, requests stay sequential, existing sets/edits stay intact.
   Generation finishing on an ended lesson must not open a late review or play anything.
10. Cancel during a request and between lessons; repeat with Forget key, Rescan/Locate
    and close. Saved successes remain; restart must not resume spending. Preview again
    to inspect safe reuse versus uncertain checkpoints. Check the provider dashboard
    rather than assuming cancellation made a request free.

11. With separately approved paid generation, try a poorly explained but clearly named
    concept. Check that the combined answer/context teaches it without replaying the
    video, with a useful example when needed—not jargon repetition or a new topic.
    Questions should stand alone, avoid attribution boilerplate and retain actual
    tool/version/scenario qualifications. Unidentified slides must not be invented.
    Try context longer than 500 characters, edit/save/restart and check the full text
    and original evidence remain. Existing sets must change only after explicit regeneration.

Real WebKitGTK/WebView2 fullscreen/input, live provider behavior/billing, subjective
card quality and installed Windows behavior are not established by unit tests.
