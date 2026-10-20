# Flashcard generation trial

This is a command-line experiment for the existing Tauri project's transcripts.
The CLI does not change the app, database, player or course files.
The runner uses Node 22.19 (the repo's `.nvmrc`) and built-in fetch; no SDK/dependency
or model download is needed.

The installed-app integration is now available in **unreleased Tauri source**;
see [the in-app guide](flashcards.md). The CLI re-exports pure rules from
`src/lib/flashcards/core.ts`, so prompts/parsing/validation stay shared. Its Node
transport and ignored trial outputs remain separate: the app does not import
these runs automatically or start paid calls because a trial key exists.

## First transcript

The approved first input is the existing two-minute Postgres introduction:

```sh
pnpm trial:flashcards "subtitle-trial.local/benchmark/lesson.en.vtt"
```

Without `--send`, this only parses the transcript and prepares private local files.
It makes no API calls, even when a key is configured. The introduction may warrant
very few cards or zero; speaker biographies and course promises should not become filler.

To run a paid request, set your key privately in the same Bash terminal. `read -s`
hides the input and keeps the key out of the command itself and shell history:

```bash
read -rsp 'Z.ai API key: ' ZAI_API_KEY
export ZAI_API_KEY
pnpm trial:flashcards "subtitle-trial.local/benchmark/lesson.en.vtt" --send
unset ZAI_API_KEY
```

Do not paste the key into chat, source code or the transcript. An environment export
in your terminal is not automatically available to an already running coding agent.
No key is saved by the runner. Avoid shell tracing (`set -x`) while setting secrets.
`--send` uploads the plain-text transcript with cue-ID labels to Z.ai and uses your credits;
it sends no video, notes, course-folder path or API key in the prompt.

## Output and limits

Each invocation creates a fresh `flashcard-trial.local/run-*` folder, ignored by
the existing `*.local` Git rule. On Linux it uses private directory/file permissions.
No earlier run is overwritten or automatically deleted. Private transcript copies
are in `preview.json`; do not commit/share that folder indiscriminately.

- `preview.json`: section requests for inspection (no API key).
- `report.json`: transcript fingerprint, duration, limits, per-request time/status,
  model/prompt version, section candidate counts, selection notes and reported tokens
  for new requests. Reused responses and their original usage are listed separately.
  `coverage` lists available and selected candidates by chronological section; populated
  sections with no selected cards get a review warning, not an automatic retry or filler card.
- `section-N.json`: validated candidate cards retained as individual requests finish.
- `section-N.normalizations.json`: any repeated cue IDs collapsed after validation,
  including zero-based card indexes, cue IDs and counts removed. The report summarizes these.
- `response-N.unvalidated.json`: parsed model content saved before card/selection validation,
  for debugging failed runs. These files are untrusted output, never accepted cards.
- `cards.json`: selected cards, locally derived timestamps and up to five quick-review IDs.
- `review.txt`: plain-text questions, answers and cited excerpts for manual inspection.
- `selection-preview.json`: the exact compact selection messages, when selection runs.
- `reused-N.unvalidated.json`: immutable local copies of checkpoint responses (no new API call).

## Lesson content and extra context

Since prompt version 3, each card separates a transcript-derived `answer` from a
nullable `extraContext` field. Extra context clarifies the **same taught concept**
with stable background knowledge or an illustrative example (original cap 500 characters;
prompt 8/validator 7 permit 1,200). It is null when unnecessary. Version 4 also normalizes an omitted field to null; explicitly
invalid values still fail, as do unknown fields. Saved cards always include `extraContext`.
The review labels it **AI-added; not independently verified**;
lesson citations apply only to the lesson answer, not this additional explanation.
There is no web lookup or source verification in this trial, so added context must be
checked too. The prompt forbids invented sources, tangents and version-dependent claims.

For slide-heavy lessons, a clearly identified concept can receive that short clarification.
The model must not pretend to see slide text, code or diagrams. When a transcript only
points to an unidentified visual ("this", "as shown here"), the prompt asks it to skip the
card and note the missing visual context. This cannot recover content absent from the
transcript; slide/image input would be a separate future decision.

Prompts also request focused questions, no overlapping facts, and preservation of the
instructor's qualifications/exceptions. These are quality instructions, not guarantees
enforced by JSON validation. Actual output still needs human review.

Prompt version 6 strengthens these instructions: keep tool/settings/time qualifiers in
both question and answer, prefer durable concepts to product/price trivia, and do not
merely restate an answer as extra context. A slide being mentioned is not a reason to
discard an explanation that is complete in the spoken transcript.

Prompt version 7 prioritizes definitions, purposes, mechanisms, distinctions and useful
concept/tool applications over recalling instructor-specific code or workflow steps.
The extraction payload now contains only `cueId` and `text`, with explicit allowed IDs
and a section-valid example; numeric timestamps stay local to avoid confusing seconds
with cue IDs. Evidence checks remain strict. Existing saved/reused cards are not rewritten.

Prompt version 8 makes conceptual understanding the objective: self-contained questions
that name a concept, direct plain-English explanations and proactively useful AI-added
foundations, mechanisms and examples. Avoid repetitive "according to the instructor/course"
wording without stripping actual conditions or making opinions universal. A clearly taught
concept may receive background explanation even when poorly defined, but tangents, new
syllabi, unseen slides and unidentified visual references must not be invented. Context
targets 2–4 short sentences when useful (hard cap 1,200), not a mandatory essay or example.
Existing saved/reused text is never retroactively rewritten. No extra API stage is added.

Selection now receives explicit section-to-candidate groups and is asked to identify
distinct concepts throughout the lesson, including late sections, before filling its
budget. It should merge overlapping learning goals and choose a varied first-five review.
These are not equal per-section quotas: empty, repeated or insubstantial material does
not deserve filler. A card's primary section is its earliest cited cue. Section grouping
and coverage warnings are diagnostics, not automatic judgments of topic completeness,
answer quality or factual correctness. Unit tests verify the prompt/report plumbing,
not that a model will follow those instructions on every run.

## Request limits and validation

The model is fixed to `glm-5.3-flash`, JSON-object output and low reasoning effort.
Thinking remains enabled as required by that model. Each request has an 8,192-output-token
cap (including the provider's output budget), a three-minute timeout and a 1 MiB response
limit. Transcript input is capped at 2 MiB/10,000 cues. Sections preserve cue boundaries,
with at most 15 minutes or approximately 22,000 serialized characters per section.
An individually long cue remains intact. At most eight sections plus one selection
request are allowed; oversized lessons fail before network requests. All request messages
have a 65,000-character serialized cap, including JSON escaping.

Short lessons normally need one request; a surplus response may need a second selection
request. Longer lessons extract candidates sequentially, then select nonredundant existing
candidate IDs across the lesson. The model identifies
topics inside bounded chronological sections; these are not guaranteed chapter boundaries.
Exact normalized duplicate questions are also removed locally. Suggested whole-lesson
ranges are 3–7 cards up to 15 minutes, 5–12 up to 30 minutes, and 10–25 above that.
These are not minimums: fewer/zero is valid. The first five selected cards form a quick review.

Version 5 separates **requested counts** from **hard safety limits**. The prompt requests
at most 12 candidates per section of a long lesson, but validation accepts up to 32.
Usually 1–12 source cues are requested per card, with a hard cap of 32. Every field and
citation is validated before deduplication/selection, including surplus cards. No evidence
is silently dropped. Malformed content, unknown IDs, excessive text or hard-cap
violations still stop the run. Surplus candidates stay in section files; final selection
keeps the whole-lesson cap (at most 7, 12 or 25, depending on duration). Counts are not
increased to force more learning material.

Selection receives IDs, importance, first-cue location, questions, lesson answers and a
labeled unverified AI-context preview (at most 480 characters), not repeated source quotes.
It judges combined learning value, not verified facts. Longer context does not itself
make a card better. Full explanations remain stored; preview abbreviation is flagged.
Question/answer text stays intact when it fits; context previews are always capped at
480 characters. If the combined request is too large, question/answer/context
**selection previews only** are shortened to a budget calculated from actual serialized
messages. All candidate IDs
stay present, full cards/citations remain unchanged locally, and both the selection payload
and report flag abbreviation. Very dense lessons may lose useful distinctions in this
view: manually inspect coverage, not just schema validity. Selection cannot establish
whether the original evidence logically supports the answer.

No automatic retry, provider/model fallback, web search or external tool call is used.
Ctrl+C cancels the local request; upstream processing may still consume credits. A timeout,
HTTP error or invalid response can also cost tokens. Missing usage is reported as unknown,
never zero. Completed section files and the usage report survive later failures. Retrying
the command without `--resume` starts a new run and may charge for the same transcript again.

The runner checks the JSON shape, card count/text limits and referenced cue IDs.
Since version 2, the runner asks the model for cue IDs only and copies their original text and timestamps
locally. This avoids rejecting cards because a model paraphrased a quote or combined text
from several subtitle cues. Version 4 permitted 12 cited cues; version 5's separate
32-cue safety bound avoids failing on a complete explanation split over many short cues.
Every raw citation is validated; none are silently truncated. Validator version 6 then
collapses repeated valid cue IDs in each card, retaining first-occurrence order and the
locally copied source text. This is recorded explicitly, not treated as a second source.
Unknown/out-of-section IDs, non-integer IDs or extra fields on a repeated reference still
fail before normalization. The raw 32-entry cap applies before deduplication. Original
responses remain unchanged. Prompt and validator versions are recorded separately;
prompt version 6 adds quality guidance without changing the validator's schema.
Extra context cannot replace required transcript evidence.
These checks do not prove that an answer follows logically from its evidence, or that
extra context is correct and in scope; manual review is still required.
Only parsed model message content is preserved privately for debugging; full provider
responses, reasoning and authorization headers are not dumped into logs/files.

The first version discarded unvalidated content; its older failed runs cannot be
recovered locally. New failures preserve content and usage for inspection before a retry.

## Resume a received partial run

First inspect and prepare locally (no key or credits required):

```sh
pnpm trial:flashcards "path/to/original-lesson.vtt" --resume "flashcard-trial.local/run-..."
```

Then configure the key privately and add `--send` to make only the missing requests:

```sh
pnpm trial:flashcards "path/to/original-lesson.vtt" --resume "flashcard-trial.local/run-..." --send
unset ZAI_API_KEY
```

Resume supports compatible versions 2–8, checks transcript SHA-256, model, exact section
boundaries and a contiguous sequence of received stages, then revalidates every saved
response before any new API request. A changed/invalid transcript, unsupported history,
unknown IDs or malformed response stops locally. Failed/in-flight/missing responses are
not automatically reissued: their upstream usage may be ambiguous. Inspect before starting
a fresh paid run. No repair API or automatic retry is hidden behind resume.

A fresh private run directory holds copied responses (with hashes and original prompt
versions), revalidated sections and new request records. The previous run is never written.
Even a prepared resume can be used as a checkpoint; resumed runs can be resumed again.
An already completed selection can be reused without any network call or key.
`requests`/`tokenUsage` describe only new requests; `reusedRequests` records previously paid
usage separately, so it is not counted as a new charge or interpreted as package billing.
Prompt versions can differ across reused/new sections and are recorded explicitly.
Reusing an older completed selection does not regenerate it under the new prompt or
rewrite its answers; a new report can flag coverage gaps in that unchanged selection.

## Offline recovery of a saved response

A received single-section response from trial version 2–8 can be validated again
without calling the API or configuring a key:

```sh
node --experimental-strip-types scripts/flashcards/recover.ts "flashcard-trial.local/run-..." "path/to/original-lesson.vtt"
```

Recovery checks the original transcript's SHA-256, section boundaries, model and received
request status, then applies the current card validator and local exact-question deduplication.
It rejects missing responses, invalid citations, mismatched transcripts and multi-section
runs; it never regenerates content or silently discards invalid cards. Validation errors
identify the card/field using zero-based indexes (for example `response.cards[1].answer`).

Outputs go into a fresh private `recovered-*` subfolder of the selected run. Original
response, prompt and report files remain untouched, including on repeated recovery.
`recovery.json` records original file hashes, prompt version and previously reported
usage separately from the recovery's zero API requests. This is schema/reference
validation, not fact-checking or confirmation that every answer is useful and supported.
This older recovery command retains the strict final card cap and never calls the API;
use the resumable runner for multi-section runs or surplus candidates needing selection.

## Locally reviewed sample

An assistant-curated quality pass can be kept separately under an ignored run's
`reviewed-*` directory. It is **not fresh GLM output or an independent fact-check**.
Keep the original cards and API report unchanged. The local review recipe and report
record source hashes, original candidate IDs, merges/omissions, edit reasons, cited cues
and before/after chronological coverage. Revised card text must pass the same length,
schema and cue-ID validation; references and timestamps are derived locally again.
This preserves auditability but still cannot prove that every edited answer follows
from its evidence. Added background remains labeled and distinct from the lesson answer.

The current long-lesson sample was edited offline: overlapping ideas were combined,
context-specific claims qualified, and substantive late-section concepts restored.
The one-off review script/recipe and private course text stay ignored, not app code or
public fixtures. Such an editorial example demonstrates the desired output, not the
automated prompt's measured success. Inspect it before approving app integration.

## Evaluate before integrating

1. Inspect every card against the cited explanation; reject invented details, trivia,
   duplicate concepts and vague questions. Preserve qualifications, and check that added
   context is correct, brief, useful and clearly separate from the instructor's explanation.
2. Compare API-reported usage with your Z.ai package balance before/after. The runner
   does not claim that raw token counts equal the pack's billing units or verify eligibility.
3. Try a substantive short technical lesson, then an hour-long lesson. Supply each
   VTT/SRT path explicitly and inspect preparation before adding `--send`.
4. Check concept coverage and the first-five review selection, not just card count.
5. Approve the results before implementing SQLite storage, app UI or whole-course generation.

Tests run entirely with mocked API responses; they consume no credits:

```sh
pnpm exec vitest run build/flashcardTrial.test.ts build/flashcardResume.test.ts
pnpm exec tsc --project scripts/flashcards/tsconfig.json
```

Provider references: [model](https://docs.z.ai/guides/vlm/glm-5.3-flash),
[Chat Completion](https://docs.z.ai/api-reference/llm/chat-completion),
[JSON output](https://docs.z.ai/guides/capabilities/struct-output).
