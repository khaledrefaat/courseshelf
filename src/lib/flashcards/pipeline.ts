import {
	type Card,
	type Cue,
	cardRange,
	chunks,
	deduplicate,
	extractionMessages,
	MAX_CANDIDATES_PER_SECTION,
	MAX_EVIDENCE_CUES,
	MAX_EXTRA_CONTEXT_CHARACTERS,
	MAX_OUTPUT_TOKENS,
	MODEL,
	PROMPT_VERSION,
	sectionCoverage,
	selectionMessages,
	transcript,
	VALIDATOR_VERSION,
	validateCards,
	validateSelection,
	withReferences,
} from "./core.ts";

export interface Usage {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
}
export interface Reply {
	content: string;
	model: string;
	finishReason: string;
	usage: Usage | null;
}
export interface Source {
	content: string;
	filename: string;
	sourceHash: string;
	sourceFingerprint: string;
}
export interface Bounds {
	firstCue: number;
	lastCue: number;
}
export interface Checkpoint {
	version: number;
	id: string;
	lesson: { courseId: number; lessonId: number; relativePath: string };
	sourceHash: string;
	sourceFingerprint: string;
	model: string;
	promptVersion: string;
	validatorVersion: string;
	sections: Bounds[];
	requests: { stage: string; status: string; hash: string | null }[];
}
export interface Preparation {
	id: string;
	source: Source;
	resume: {
		checkpoint: Checkpoint;
		replies: Reply[];
		resumable: boolean;
	} | null;
	checkpointError: string | null;
}
export interface TimedEvidence {
	cueId: number;
	quote: string;
	start: number;
	end: number;
}
export interface GeneratedCard {
	question: string;
	answer: string;
	extraContext: string | null;
	evidence: TimedEvidence[];
}
export interface GenerationResult {
	cards: GeneratedCard[];
	notes: string[];
	usage: { newRequests: (Usage | null)[]; reusedRequests: (Usage | null)[] };
}

export function plan(source: Source) {
	if (new TextEncoder().encode(source.content).length > 2 * 1024 * 1024)
		throw new Error("Transcript exceeds the 2 MiB limit.");
	const cues = transcript(source.content),
		sections = chunks(cues);
	return {
		cues,
		sections,
		range: cardRange(cues[cues.length - 1].end),
		bounds: sections.map((section) => ({
			firstCue: section[0].id,
			lastCue: section[section.length - 1].id,
		})),
		maximumRequests: sections.length + 1,
	};
}
export function canResume(
	prepared: Preparation,
	identity: Checkpoint["lesson"],
): boolean {
	const saved = prepared.resume,
		current = saved?.checkpoint;
	return (
		!!saved?.resumable &&
		!!current &&
		current.version === 1 &&
		current.model === MODEL &&
		current.promptVersion === PROMPT_VERSION &&
		current.validatorVersion === VALIDATOR_VERSION &&
		current.lesson.courseId === identity.courseId &&
		current.lesson.lessonId === identity.lessonId &&
		current.lesson.relativePath === identity.relativePath &&
		current.sourceHash === prepared.source.sourceHash &&
		current.sourceFingerprint === prepared.source.sourceFingerprint &&
		JSON.stringify(current.sections) ===
			JSON.stringify(plan(prepared.source).bounds) &&
		current.requests.length === saved.replies.length &&
		current.requests.every(
			(record, index) =>
				record.status === "received" &&
				record.stage ===
					(index < current.sections.length
						? `section-${index + 1}`
						: "selection"),
		) &&
		current.requests.length <= current.sections.length + 1
	);
}
function parse(reply: Reply): unknown {
	if (reply.model !== MODEL)
		throw new Error(
			"Provider returned a different model. Existing cards were kept.",
		);
	if (reply.finishReason === "length")
		throw new Error(
			`Provider output limit reached (${MAX_OUTPUT_TOKENS.toLocaleString("en-US")} tokens). The response is incomplete; retry requires explicit confirmation.`,
		);
	if (reply.finishReason !== "stop")
		throw new Error(
			"Provider returned incomplete output. Existing cards were kept.",
		);
	try {
		return JSON.parse(reply.content);
	} catch {
		throw new Error(
			"Provider returned invalid card JSON. The received response was checkpointed; no retry was sent.",
		);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

// A provider sometimes returns [189] instead of [{cueId: 189}]. Wrap only
// safe integers, without coercion or ID remapping. Keep every other field and
// entry for the strict validator, and never modify the checkpointed response.
function normalizeNumericEvidence(value: unknown) {
	let count = 0;
	if (
		!isRecord(value) ||
		!Array.isArray(value.cards) ||
		value.cards.length > MAX_CANDIDATES_PER_SECTION
	)
		return { value, count };
	const cards = value.cards.map((card: unknown) => {
		if (
			!isRecord(card) ||
			!Array.isArray(card.evidence) ||
			card.evidence.length > MAX_EVIDENCE_CUES
		)
			return card;
		const evidence = card.evidence.map((reference: unknown) => {
			if (typeof reference !== "number" || !Number.isSafeInteger(reference))
				return reference;
			count++;
			return { cueId: reference };
		});
		return { ...card, evidence };
	});
	return { value: { ...value, cards }, count };
}

function extraction(reply: Reply, cues: readonly Cue[], section: number) {
	try {
		const normalized = normalizeNumericEvidence(parse(reply));
		return {
			...validateCards(normalized.value, cues, MAX_CANDIDATES_PER_SECTION),
			numericEvidenceReferences: normalized.count,
		};
	} catch (cause) {
		throw new Error(
			`Section ${section}: ${cause instanceof Error ? cause.message : "Invalid flashcard response."} No retry was sent; existing cards were kept.`,
		);
	}
}

// Validate ALL received stages before any new request. Never quietly regenerate a
// paid stage because its content is malformed, duplicated or from another source.
export function validateReceived(source: Source, replies: readonly Reply[]) {
	const current = plan(source);
	if (replies.length > current.maximumRequests)
		throw new Error("Too many checkpoint responses.");
	const extracted = replies
		.slice(0, current.sections.length)
		.map((reply, index) =>
			extraction(reply, current.sections[index], index + 1),
		);
	const candidates = deduplicate(extracted.flatMap((result) => result.cards));
	const selection = replies[current.sections.length];
	if (selection)
		validateSelection(parse(selection), candidates, current.range.max);
	return { current, extracted };
}

export function remainingRequests(source: Source, replies: readonly Reply[]) {
	const { current, extracted } = validateReceived(source, replies);
	if (extracted.length < current.sections.length)
		return current.sections.length - extracted.length + 1;
	const selectionNeeded =
		current.sections.length > 1 ||
		deduplicate(extracted.flatMap((result) => result.cards)).length >
			current.range.max;
	return selectionNeeded && replies.length === current.sections.length ? 1 : 0;
}

// Explicit recovery may reuse only the contiguous validated prefix. Never coerce
// cue IDs, ignore extra fields, or include candidates from a failed response.
export function inspectRecovery(
	prepared: Preparation,
	identity: Checkpoint["lesson"],
) {
	if (
		prepared.checkpointError ||
		!prepared.resume ||
		!canResume(prepared, identity)
	)
		return null;
	const replies = prepared.resume.replies;
	for (let index = 0; index < replies.length; index++) {
		try {
			validateReceived(prepared.source, replies.slice(0, index + 1));
		} catch (cause) {
			return {
				keep: index,
				reason: cause instanceof Error ? cause.message : "Invalid response.",
				requests: remainingRequests(prepared.source, replies.slice(0, index)),
			};
		}
	}
	return null;
}

export async function generate(
	source: Source,
	reused: readonly Reply[],
	ask: (
		stage: string,
		messages: ReturnType<typeof extractionMessages>,
	) => Promise<Reply>,
	check: () => void,
): Promise<GenerationResult> {
	const { current, extracted } = validateReceived(source, reused);
	const newRequests: (Usage | null)[] = [],
		notes: string[] = [];
	const cards: Card[] = [];
	for (let index = 0; index < current.sections.length; index++) {
		check();
		let result = extracted[index];
		if (!result) {
			const reply = await ask(
				`section-${index + 1}`,
				extractionMessages(
					current.sections[index],
					current.sections.length > 1 ? 12 : current.range.max,
					current.range,
				),
			);
			check();
			newRequests.push(reply.usage);
			result = extraction(reply, current.sections[index], index + 1);
		}
		cards.push(...result.cards);
		if (result.notes) notes.push(result.notes);
		if (result.numericEvidenceReferences)
			notes.push(
				`Section ${index + 1}: normalized ${result.numericEvidenceReferences} numeric evidence references to cueId objects without changing IDs; original response retained.`,
			);
		if (result.normalizations.length)
			notes.push(
				`Section ${index + 1}: repeated valid cue references were collapsed after validation.`,
			);
	}
	const candidates = deduplicate(cards);
	let selected = candidates;
	if (current.sections.length > 1 || candidates.length > current.range.max) {
		check();
		const messages = selectionMessages(
			candidates,
			current.range,
			current.sections,
		);
		const cached = reused[current.sections.length];
		const reply = cached ?? (await ask("selection", messages));
		check();
		if (!cached) newRequests.push(reply.usage);
		const result = validateSelection(
			parse(reply),
			candidates,
			current.range.max,
		);
		selected = result.cards;
		if (result.notes) notes.push(result.notes);
		if (
			messages.some((message) =>
				message.content.includes('"previewsTruncated":true'),
			)
		)
			notes.push(
				"Selection previews were abbreviated to fit request limits; inspect topic coverage.",
			);
	}
	for (const row of sectionCoverage(candidates, selected, current.sections)) {
		if (row.available && !row.selected)
			notes.push(
				`Review coverage: section ${row.section} had ${row.available} candidates but no selected cards.`,
			);
	}
	check();
	return {
		cards: withReferences(selected, current.cues).map((card) => ({
			question: card.question,
			answer: card.answer,
			extraContext: card.extraContext,
			evidence: card.evidence.map((evidence) => ({
				...evidence,
				start: evidence.start ?? 0,
				end: evidence.end ?? 0,
			})),
		})),
		notes,
		usage: { newRequests, reusedRequests: reused.map((reply) => reply.usage) },
	};
}

export function validateEdit(
	question: string,
	answer: string,
	extraContext: string | null,
) {
	const fields = {
		question: question.trim(),
		answer: answer.trim(),
		extraContext: extraContext?.trim() || null,
	};
	if (
		!fields.question ||
		fields.question.length > 300 ||
		!fields.answer ||
		fields.answer.length > 1500 ||
		(fields.extraContext?.length ?? 0) > MAX_EXTRA_CONTEXT_CHARACTERS
	)
		throw new Error(
			`Use a question of 1–300 characters, an answer of 1–1500 and optional context up to ${MAX_EXTRA_CONTEXT_CHARACTERS} characters.`,
		);
	return fields;
}

export function timestamp(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds));
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
