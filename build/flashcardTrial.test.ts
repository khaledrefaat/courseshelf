import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	type Card,
	cardRange,
	chunks,
	deduplicate,
	extractionMessages,
	MAX_CHUNKS,
	MAX_EVIDENCE_CUES,
	MAX_EXTRA_CONTEXT_CHARACTERS,
	MODEL,
	plainText,
	selectionMessages,
	transcript,
	validateCards,
	validateSelection,
	withReferences,
} from "../scripts/flashcards/core.ts";
import { recoverSingleSection } from "../scripts/flashcards/recover.ts";
import { runTrial } from "../scripts/flashcards/trial.ts";

const vtt =
	"WEBVTT\n\n00:00.000 --> 00:05.000\nIndexes speed up lookups.\n\n00:05.000 --> 00:10.000\nIndexes can increase write cost.\n";
const cues = transcript(vtt);
const card: Card = {
	question: "What can an index improve?",
	answer: "It can speed up lookups.",
	extraContext: null,
	importance: 1,
	evidence: [{ cueId: 1, quote: "Indexes speed up lookups." }],
};
const modelCard = { ...card, evidence: [{ cueId: 1 }] };
it("validates then collapses repeated cue IDs without mutating or inventing evidence", () => {
	const raw = {
		cards: [
			{
				...modelCard,
				evidence: [
					{ cueId: 1 },
					{ cueId: 2 },
					{ cueId: 1 },
					{ cueId: 1 },
					{ cueId: 2 },
				],
			},
		],
		notes: "",
	};
	const before = JSON.stringify(raw);
	const result = validateCards(raw, cues, 7);
	expect(result.cards[0].evidence).toEqual([
		{ cueId: 1, quote: cues[0].text },
		{ cueId: 2, quote: cues[1].text },
	]);
	expect(result.normalizations).toEqual([
		{ cardIndex: 0, cueId: 1, removed: 2 },
		{ cardIndex: 0, cueId: 2, removed: 1 },
	]);
	expect(JSON.stringify(raw)).toBe(before);
	expect(
		validateCards({ cards: [modelCard], notes: "" }, cues, 7).normalizations,
	).toEqual([]);
});
it.each([
	{ cueId: 1, quote: "invented duplicate quote" },
	{ cueId: "1" },
	{ cueId: 1.5 },
	{ cueId: 999 },
	{ cueId: 1, unexpected: true },
])(
	"never hides a malformed reference during duplicate normalization: %j",
	(invalid) => {
		expect(() =>
			validateCards(
				{
					cards: [{ ...modelCard, evidence: [{ cueId: 1 }, invalid] }],
					notes: "",
				},
				cues,
				7,
			),
		).toThrow("evidence[1]");
	},
);
it("enforces the raw citation safety cap even when every entry repeats the same valid ID", () => {
	expect(() =>
		validateCards(
			{
				cards: [
					{
						...modelCard,
						evidence: Array.from({ length: MAX_EVIDENCE_CUES + 1 }, () => ({
							cueId: 1,
						})),
					},
				],
				notes: "",
			},
			cues,
			7,
		),
	).toThrow(`expected 1–${MAX_EVIDENCE_CUES}`);
});
it("reuses VTT/SRT parsing, preserves mixed text and derives timestamps from cited cues", () => {
	expect(
		transcript("1\n00:00:01,000 --> 00:00:03,000\nملاحظات English")[0],
	).toEqual({ id: 1, start: 1, end: 3, text: "ملاحظات English" });
	expect(
		plainText("<v Speaker><b>A &amp; B</b></v>\n<00:00:01.000> more"),
	).toBe("A & B more");
	expect(withReferences([card], cues)[0].evidence[0]).toMatchObject({
		start: 0,
		end: 5,
	});
	expect(() =>
		transcript(
			"WEBVTT\n\n00:05.000 --> 00:06.000\nLater\n\n00:01.000 --> 00:02.000\nEarlier",
		),
	).toThrow("chronological");
});
it("bounds sections without losing or splitting cues, preserving evidence IDs for an hour lesson", () => {
	const hour = Array.from({ length: 120 }, (_, i) => ({
		id: i + 1,
		start: i * 30,
		end: i * 30 + 30,
		text: `Concept ${i}`,
	}));
	const parts = chunks(hour);
	expect(parts).toHaveLength(4);
	expect(parts.flat()).toEqual(hour);
	for (const part of parts) {
		expect(part.at(-1)?.end - part[0].start).toBeLessThanOrEqual(900);
		expect(JSON.stringify(part).length).toBeLessThanOrEqual(22_000);
	}
	expect(() =>
		chunks(
			Array.from({ length: MAX_CHUNKS + 1 }, (_, i) => ({
				id: i + 1,
				start: i * 901,
				end: i * 901 + 1,
				text: "Concept",
			})),
		),
	).toThrow("at most");
	const large = Array.from({ length: 40 }, (_, i) => ({
		id: i + 1,
		start: i,
		end: i + 1,
		text: "a".repeat(2000),
	}));
	expect(chunks(large).length).toBeGreaterThan(1);
	expect(chunks(large).flat()).toEqual(large);
});
it("uses count guidelines without requiring filler and permits zero cards for introductions", () => {
	expect(cardRange(600)).toEqual({ min: 3, max: 7 });
	expect(cardRange(1200)).toEqual({ min: 5, max: 12 });
	expect(cardRange(3600)).toEqual({ min: 10, max: 25 });
	expect(
		validateCards({ cards: [], notes: "Introduction only" }, cues, 7).cards,
	).toEqual([]);
	expect(extractionMessages(cues, 7, cardRange(10))[0].content).toContain(
		"untrusted data",
	);
	expect(selectionMessages([card], cardRange(3600))[1].content).toContain(
		"five best core cards",
	);
});
it("rejects nonexistent references, fabricated quotes, malformed or oversized cards and excessive output", () => {
	for (const change of [
		{ evidence: [{ cueId: 99 }] },
		{ evidence: [{ cueId: 1, quote: "Indexes always improve performance" }] },
		{ evidence: [] },
		{ importance: "1" },
		{ importance: 4 },
		{ question: " " },
		{ answer: "x".repeat(1501) },
		{ extraContext: "x".repeat(1201) },
		{ extraContext: " " },
		{ extraContext: 42 },
		{ extraContext: undefined },
		{ sql: "DELETE" },
	])
		expect(() =>
			validateCards(
				{ cards: [{ ...modelCard, ...change }], notes: "" },
				cues,
				7,
			),
		).toThrow();
	expect(() =>
		validateCards(
			{ cards: Array.from({ length: 8 }, () => modelCard), notes: "" },
			cues,
			7,
		),
	).toThrow("count");
	expect(
		validateCards({ cards: [modelCard], notes: "" }, cues, 7).cards,
	).toEqual([card]);
});
it("copies original evidence locally across adjacent cues without asking the model to reproduce quotes", () => {
	const result = validateCards(
		{
			cards: [{ ...modelCard, evidence: [{ cueId: 1 }, { cueId: 2 }] }],
			notes: "",
		},
		cues,
		7,
	);
	expect(result.cards[0].evidence).toEqual([
		{ cueId: 1, quote: cues[0].text },
		{ cueId: 2, quote: cues[1].text },
	]);
	const prompt = JSON.parse(
		extractionMessages(cues, 7, cardRange(10))[1].content,
	);
	expect(prompt.shape.cards[0].evidence).toEqual([{ cueId: 1 }]);
	expect(prompt.task).toContain("Do not supply quotes");
	expect(prompt.transcript).toEqual(
		cues.map((cue) => ({ cueId: cue.id, text: cue.text })),
	);
	expect(prompt.allowedCueIds).toEqual(cues.map((cue) => cue.id));
});
it("deduplicates normalized questions, prefers core cards and accepts only original candidate IDs", () => {
	const detail = { ...card, importance: 3 };
	expect(
		deduplicate([detail, { ...card, question: "WHAT can an index improve!" }]),
	).toEqual([{ ...card, question: "WHAT can an index improve!" }]);
	expect(
		validateSelection({ selectedIds: [1], notes: "" }, [card], 7).cards,
	).toEqual([card]);
	for (const ids of [[0], [2], [1, 1], ["1"]])
		expect(() =>
			validateSelection({ selectedIds: ids, notes: "" }, [card], 7),
		).toThrow();
});
it("keeps optional scoped background separate from lesson answers and references", () => {
	const extraContext =
		"A book's index is a useful analogy for finding a topic quickly.";
	const result = validateCards(
		{ cards: [{ ...modelCard, extraContext }], notes: "" },
		cues,
		7,
	);
	expect(result.cards[0]).toEqual({ ...card, extraContext });
	expect(withReferences(result.cards, cues)[0].evidence).toEqual([
		{ ...card.evidence[0], start: 0, end: 5 },
	]);
	expect(
		validateSelection({ selectedIds: [1], notes: "" }, result.cards, 7).cards,
	).toEqual(result.cards);
	// Background cannot replace the required transcript anchor.
	expect(() =>
		validateCards(
			{ cards: [{ ...modelCard, extraContext, evidence: [] }], notes: "" },
			cues,
			7,
		),
	).toThrow();
	const system = extractionMessages(cues, 7, cardRange(10))[0].content;
	expect(system).toContain(
		"Preserve the instructor's qualifications and exceptions",
	);
	expect(system).toContain("Never guess unseen slide text");
	expect(system).toContain("skip that card");
	expect(system).toContain("definitions, purposes, mechanisms");
	expect(system).toContain("workflow sequences or personal choices");
	expect(system).toContain("do not remove qualifications");
	expect(system).toContain("Remove overlapping cards");
	expect(
		validateCards({ cards: [], notes: "Missing visual context." }, cues, 7)
			.cards,
	).toEqual([]);
});
it("teaches named concepts with direct explanations and proactive in-scope examples rather than attribution/trivia", () => {
	const system = extractionMessages(cues, 7, cardRange(10))[0].content;
	for (const rule of [
		"understand and explain each idea",
		"Name the concept in the question",
		"Unpack essential jargon and acronyms",
		"Use direct teaching language, not repetitive attribution",
		"according to this course",
		"Actively use extraContext",
		"not a new syllabus",
		"put the missing definition in extraContext",
		"not something seen in the video",
		"What is a base case in recursion?",
		"When is mocking useful in a test?",
		"without another recursive call",
	])
		expect(system).toContain(rule);
	expect(system).toContain(
		`at most ${MAX_EXTRA_CONTEXT_CHARACTERS} characters`,
	);
	const payload = JSON.parse(
		extractionMessages(cues, 7, cardRange(10))[1].content,
	);
	expect(payload.task).toContain("using AI-added context proactively");
	expect(payload.transcript).toEqual(
		cues.map((cue) => ({ cueId: cue.id, text: cue.text })),
	);
});
it("requests bounded compact output for extraction and selection without changing learning goals", async () => {
	for (const messages of [
		extractionMessages(cues, 7, cardRange(10)),
		selectionMessages([card], cardRange(10), [cues]),
	]) {
		const system = messages[0].content;
		for (const rule of [
			"compact single-line JSON",
			"whitespace before or after the object",
			"stop immediately after the final closing brace",
			"at most 300 characters",
			"fewer complete, well-supported cards",
			"do not shorten away essential qualifications",
			"Actively use extraContext",
		])
			expect(system).toContain(rule);
	}
	expect(
		await readFile(
			new URL("../src-tauri/src/flashcards/mod.rs", import.meta.url),
			"utf8",
		),
	).toContain('const PROMPT: &str = "flashcards-trial-9";');
});
it("allows a longer focused explanation but still bounds context and requires real cue references", () => {
	const context = "x".repeat(MAX_EXTRA_CONTEXT_CHARACTERS);
	const raw = { cards: [{ ...modelCard, extraContext: context }], notes: "" };
	expect(validateCards(raw, cues, 7).cards[0].extraContext).toBe(context);
	expect(() =>
		validateCards(
			{ ...raw, cards: [{ ...modelCard, extraContext: `${context}x` }] },
			cues,
			7,
		),
	).toThrow("extraContext");
	expect(() =>
		validateCards(
			{ ...raw, cards: [{ ...raw.cards[0], evidence: [{ cueId: 999 }] }] },
			cues,
			7,
		),
	).toThrow("cueId");
});
it("shows bounded labeled context to selection without inventing evidence or rewriting full cards", () => {
	const candidate = { ...card, extraContext: "Helpful example. ".repeat(60) };
	const before = JSON.stringify(candidate);
	const selection = JSON.parse(
		selectionMessages([candidate], cardRange(10))[1].content,
	);
	expect(selection.task).toContain("combined learning value");
	expect(selection.task).toContain("must not establish new course topics");
	expect(selection.candidates[0].extraContext).toHaveLength(480);
	expect(selection.candidates[0].extraContext).toMatch(/…$/);
	expect(selection.previewsTruncated).toBe(true);
	expect(selection.candidates[0]).not.toHaveProperty("evidence");
	expect(selection.candidates[0].id).toBe(1);
	expect(JSON.stringify(candidate)).toBe(before);
});
it("accepts bounded surplus source cues for a complete explanation but rejects more", () => {
	const twelve = Array.from({ length: MAX_EVIDENCE_CUES }, (_, i) => ({
		...cues[0],
		id: i + 1,
	}));
	const evidence = twelve.map(({ id }) => ({ cueId: id }));
	expect(
		validateCards({ cards: [{ ...modelCard, evidence }], notes: "" }, twelve, 7)
			.cards[0].evidence,
	).toHaveLength(MAX_EVIDENCE_CUES);
	expect(() =>
		validateCards(
			{
				cards: [
					{
						...modelCard,
						evidence: [...evidence, { cueId: MAX_EVIDENCE_CUES + 1 }],
					},
				],
				notes: "",
			},
			[...twelve, { ...cues[0], id: MAX_EVIDENCE_CUES + 1 }],
			7,
		),
	).toThrow(`response.cards[0].evidence: expected 1–${MAX_EVIDENCE_CUES}`);
});
it("normalizes omitted context, keeps supplied context and never mutates the raw response", () => {
	const withoutContext = {
		question: card.question,
		answer: card.answer,
		importance: 1,
		evidence: [{ cueId: 1 }],
	};
	const raw = {
		cards: [
			withoutContext,
			{ ...modelCard, extraContext: "Brief background." },
		],
		notes: "",
	};
	const before = JSON.stringify(raw);
	const result = validateCards(raw, cues, 7);
	expect(result.cards[0].extraContext).toBeNull();
	expect(result.cards[1].extraContext).toBe("Brief background.");
	expect(JSON.stringify(raw)).toBe(before);
});
it("identifies the exact card and field without silently dropping malformed data", () => {
	for (const [change, error] of [
		[{ answer: " " }, "response.cards[1].answer"],
		[{ importance: 9 }, "response.cards[1].importance"],
		[{ extraContext: 9 }, "response.cards[1].extraContext"],
		[
			{ evidence: [{ cueId: 99 }] },
			"response.cards[1].evidence[0].cueId: references a cue outside",
		],
		[
			{ evidence: [{ cueId: 1 }, { cueId: "1" }] },
			"response.cards[1].evidence[1].cueId: expected an integer",
		],
		[{ unexpected: true }, "response.cards[1]: unexpected fields"],
	] as const) {
		expect(() =>
			validateCards(
				{ cards: [modelCard, { ...modelCard, ...change }], notes: "" },
				cues,
				7,
			),
		).toThrow(error);
	}
	expect(() =>
		validateCards(
			{ cards: [{ question: "Missing answer" }], notes: "" },
			cues,
			7,
		),
	).toThrow("response.cards[0]: missing required field(s): answer");
});

const outputRoot = resolve("flashcard-trial.local");
let logs: ReturnType<typeof vi.spyOn>;
const owned = new Set<string>();
beforeEach(() => {
	logs = vi.spyOn(console, "log").mockImplementation(() => {});
	vi.stubEnv("ZAI_API_KEY", "");
});
afterEach(async () => {
	for (const call of logs.mock.calls) {
		const match = String(call[0]).match(/\nOutput: (.*)$/);
		if (match?.[1].startsWith(`${outputRoot}/run-`)) owned.add(match[1]);
	}
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	for (const path of owned) await rm(path, { recursive: true, force: true });
	owned.clear();
});
async function source(content = vtt) {
	await mkdir(outputRoot, { recursive: true });
	const folder = await mkdtemp(join(outputRoot, "input-test-"));
	owned.add(folder);
	const path = join(folder, "lesson.vtt");
	await writeFile(path, content);
	return path;
}
function api(content: unknown, overrides: Record<string, unknown> = {}) {
	return Response.json({
		model: MODEL,
		choices: [
			{ finish_reason: "stop", message: { content: JSON.stringify(content) } },
		],
		usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
		...overrides,
	});
}
it("dry run makes no requests, emits private preparation files, and --send requires a key", async () => {
	const path = await source(),
		fetcher = vi.fn<typeof fetch>();
	const output = await runTrial([path], fetcher);
	expect(fetcher).not.toHaveBeenCalled();
	const report = JSON.parse(
		await readFile(join(output ?? "", "report.json"), "utf8"),
	);
	expect(report.mode).toBe("dry-run");
	expect(report.limits.maximumRequests).toBe(2);
	expect(report.tokenUsage.totalTokens).toBeNull();
	await expect(runTrial([path, "--send"], fetcher)).rejects.toThrow(
		"ZAI_API_KEY",
	);
	expect(fetcher).not.toHaveBeenCalled();
});
it("mocked paid request uses only the fixed model/endpoint, saves validated cards and reported usage, never the key", async () => {
	vi.stubEnv("ZAI_API_KEY", "fake-test-secret");
	const path = await source();
	const fetcher = vi
		.fn<typeof fetch>()
		.mockResolvedValue(api({ cards: [modelCard], notes: "" }));
	const output = await runTrial([path, "--send"], fetcher);
	expect(fetcher).toHaveBeenCalledOnce();
	const [url, options] = fetcher.mock.calls[0];
	expect(url).toBe("https://api.z.ai/api/paas/v4/chat/completions");
	expect(options?.redirect).toBe("error");
	const request = JSON.parse(String(options?.body));
	expect(request.model).toBe(MODEL);
	expect(request.reasoning_effort).toBe("low");
	expect(request.response_format).toEqual({ type: "json_object" });
	expect(request).not.toHaveProperty("tools");
	const saved = await readFile(join(output ?? "", "cards.json"), "utf8"),
		report = await readFile(join(output ?? "", "report.json"), "utf8");
	expect(JSON.parse(saved).cards[0].evidence[0].start).toBe(0);
	expect(JSON.parse(report).tokenUsage.totalTokens).toBe(150);
	const unvalidated = await readFile(
		join(output ?? "", "response-1.unvalidated.json"),
		"utf8",
	);
	expect(JSON.parse(unvalidated).cards[0].evidence).toEqual([{ cueId: 1 }]);
	expect(
		report + saved + unvalidated + JSON.stringify(logs.mock.calls),
	).not.toContain("fake-test-secret");
});
it("labels outside context in the review without attributing it to the instructor", async () => {
	vi.stubEnv("ZAI_API_KEY", "fake-test-secret");
	const path = await source();
	const extraContext = "A book's index offers a familiar analogy.";
	const fetcher = vi
		.fn<typeof fetch>()
		.mockResolvedValue(
			api({ cards: [{ ...modelCard, extraContext }], notes: "" }),
		);
	const output = await runTrial([path, "--send"], fetcher);
	const review = await readFile(join(output ?? "", "review.txt"), "utf8");
	expect(review).toContain(`Lesson answer: ${card.answer}`);
	expect(review).toContain("Lesson evidence: [0:00] Indexes speed up lookups.");
	expect(review).toContain(
		`Extra context (AI-added; not independently verified): ${extraContext}`,
	);
	const saved = JSON.parse(
		await readFile(join(output ?? "", "cards.json"), "utf8"),
	);
	expect(saved.cards[0].extraContext).toBe(extraContext);
	expect(saved.cards[0].evidence[0].quote).toBe(cues[0].text);
	const report = JSON.parse(
		await readFile(join(output ?? "", "report.json"), "utf8"),
	);
	expect(report.version).toBe("flashcards-trial-9");
	expect(report.contextPolicy).toContain("not independently verified");
});

async function recoveryFixture(
	content = vtt,
	response: unknown = { cards: [modelCard], notes: "" },
) {
	const path = await source(content);
	const run = await mkdtemp(join(outputRoot, "run-"));
	owned.add(run);
	const fixtureCues = transcript(content);
	const report = {
		version: "flashcards-trial-3",
		model: MODEL,
		mode: "api",
		status: "failed",
		sourceSha256: createHash("sha256").update(content).digest("hex"),
		cueCount: fixtureCues.length,
		sections: [{ firstCue: 1, lastCue: fixtureCues.length }],
		requests: [{ status: "received" }],
		tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
	};
	await writeFile(join(run, "report.json"), JSON.stringify(report));
	await writeFile(
		join(run, "response-1.unvalidated.json"),
		JSON.stringify(response),
	);
	return { path, run, report };
}
it("recovers omitted context and seven references offline without replacing originals or making requests", async () => {
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockRejectedValue(new Error("No network allowed"));
	const content = `WEBVTT\n\n${Array.from({ length: 7 }, (_, i) => `00:0${i}.000 --> 00:0${i + 1}.000\nExplanation part ${i + 1}.`).join("\n\n")}\n`;
	const fixture = await recoveryFixture(content, {
		cards: [
			{
				question: card.question,
				answer: card.answer,
				importance: 1,
				evidence: Array.from({ length: 7 }, (_, i) => ({ cueId: i + 1 })),
			},
		],
		notes: "Review needed.",
	});
	const originals = await Promise.all(
		["report.json", "response-1.unvalidated.json"].map((file) =>
			readFile(join(fixture.run, file), "utf8"),
		),
	);
	const output = await recoverSingleSection(fixture.run, fixture.path);
	const saved = JSON.parse(await readFile(join(output, "cards.json"), "utf8"));
	expect(saved.cards).toHaveLength(1);
	expect(saved.cards[0].extraContext).toBeNull();
	expect(saved.cards[0].evidence).toHaveLength(7);
	expect(saved.cards[0].evidence[6]).toMatchObject({
		quote: "Explanation part 7.",
		start: 6,
		end: 7,
	});
	const report = JSON.parse(
		await readFile(join(output, "recovery.json"), "utf8"),
	);
	expect(report).toMatchObject({
		mode: "offline-recovery",
		requestsMade: 0,
		originalPromptVersion: "flashcards-trial-3",
		originalReportedUsage: { totalTokens: 150 },
	});
	expect(await readFile(join(output, "review.txt"), "utf8")).toContain(
		"Lesson evidence:",
	);
	const another = await recoverSingleSection(fixture.run, fixture.path);
	expect(another).not.toBe(output);
	expect(
		await Promise.all(
			["report.json", "response-1.unvalidated.json"].map((file) =>
				readFile(join(fixture.run, file), "utf8"),
			),
		),
	).toEqual(originals);
	expect(fetcher).not.toHaveBeenCalled();
});
it("offline recovery rejects a mismatched transcript before creating any output", async () => {
	const fixture = await recoveryFixture();
	await writeFile(fixture.path, `${vtt}\n`);
	await expect(recoverSingleSection(fixture.run, fixture.path)).rejects.toThrow(
		"fingerprint",
	);
	expect((await readdir(fixture.run)).sort()).toEqual([
		"report.json",
		"response-1.unvalidated.json",
	]);
});
it.each([
	"unknown evidence",
	"bad context",
	"multiple sections",
	"incomplete request",
	"wrong model",
])("offline recovery rejects %s without accepting cards", async (kind) => {
	const fixture = await recoveryFixture();
	if (kind === "unknown evidence" || kind === "bad context") {
		await writeFile(
			join(fixture.run, "response-1.unvalidated.json"),
			JSON.stringify({
				cards: [
					{
						...modelCard,
						...(kind === "unknown evidence"
							? { evidence: [{ cueId: 99 }] }
							: { extraContext: 9 }),
					},
				],
				notes: "",
			}),
		);
	} else {
		const change =
			kind === "multiple sections"
				? {
						sections: [
							{ firstCue: 1, lastCue: 1 },
							{ firstCue: 2, lastCue: 2 },
						],
					}
				: kind === "incomplete request"
					? { requests: [{ status: "failed" }] }
					: { model: "other" };
		await writeFile(
			join(fixture.run, "report.json"),
			JSON.stringify({ ...fixture.report, ...change }),
		);
	}
	await expect(
		recoverSingleSection(fixture.run, fixture.path),
	).rejects.toThrow();
	expect((await readdir(fixture.run)).sort()).toEqual([
		"report.json",
		"response-1.unvalidated.json",
	]);
});
// Creating file symlinks requires special privileges on Windows.
it.skipIf(process.platform === "win32")(
	"offline recovery rejects run aliases and linked response inputs",
	async () => {
		const fixture = await recoveryFixture();
		const alias = join(outputRoot, `${basename(fixture.run)}Alias`);
		await symlink(fixture.run, alias, "junction");
		owned.add(alias);
		await expect(recoverSingleSection(alias, fixture.path)).rejects.toThrow(
			"regular run directory",
		);
		await rm(join(fixture.run, "response-1.unvalidated.json"));
		await symlink(
			fixture.path,
			join(fixture.run, "response-1.unvalidated.json"),
		);
		await expect(
			recoverSingleSection(fixture.run, fixture.path),
		).rejects.toThrow("regular files");
	},
);
it("long lesson uses sequential extraction then selection, keeping timestamps and total usage", async () => {
	vi.stubEnv("ZAI_API_KEY", "fake-test-secret");
	const path = await source(
		`${vtt}\n00:20:00.000 --> 00:20:05.000\nIndexes can cost storage.\n`,
	);
	const other: Card = {
		question: "What extra resource can an index use?",
		answer: "Storage.",
		extraContext: null,
		importance: 2,
		evidence: [{ cueId: 3, quote: "Indexes can cost storage." }],
	};
	const fetcher = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(api({ cards: [modelCard], notes: "" }))
		.mockResolvedValueOnce(
			api({ cards: [{ ...other, evidence: [{ cueId: 3 }] }], notes: "" }),
		)
		.mockResolvedValueOnce(
			api({ selectedIds: [2, 1], notes: "Distinct concepts" }),
		);
	const output = await runTrial([path, "--send"], fetcher);
	expect(fetcher).toHaveBeenCalledTimes(3);
	const saved = JSON.parse(
		await readFile(join(output ?? "", "cards.json"), "utf8"),
	);
	expect(saved.cards[0].question).toBe(other.question);
	expect(saved.cards[0].evidence[0].start).toBe(1200);
	const report = JSON.parse(
		await readFile(join(output ?? "", "report.json"), "utf8"),
	);
	expect(report.tokenUsage.totalTokens).toBe(450);
});
it.each([
	"http",
	"network",
	"invalid JSON",
	"incomplete",
	"wrong model",
	"invented evidence",
	"oversized",
])("%s failures stop without retrying or accepting cards", async (kind) => {
	vi.stubEnv("ZAI_API_KEY", "fake-test-secret");
	const path = await source();
	const fetcher = vi.fn<typeof fetch>();
	if (kind === "http")
		fetcher.mockResolvedValue(
			new Response("private server error", { status: 429 }),
		);
	else if (kind === "network")
		fetcher.mockRejectedValue(new Error("fake-test-secret must not leak"));
	else if (kind === "invalid JSON")
		fetcher.mockResolvedValue(new Response("invalid"));
	else if (kind === "incomplete")
		fetcher.mockResolvedValue(
			api(
				{},
				{ choices: [{ finish_reason: "length", message: { content: "{}" } }] },
			),
		);
	else if (kind === "wrong model")
		fetcher.mockResolvedValue(api({}, { model: "another-model" }));
	else if (kind === "oversized")
		fetcher.mockResolvedValue(new Response("x".repeat(1_048_577)));
	else
		fetcher.mockResolvedValue(
			api({
				cards: [{ ...modelCard, evidence: [{ cueId: 99 }] }],
				notes: "",
			}),
		);
	const attempt = runTrial([path, "--send"], fetcher);
	await expect(attempt).rejects.not.toThrow("fake-test-secret");
	if (kind === "incomplete")
		await expect(attempt).rejects.toThrow(
			"Provider output limit reached (8,192 tokens)",
		);
	expect(fetcher).toHaveBeenCalledOnce();
	const output = String(logs.mock.calls[0][0]).split("\nOutput: ")[1];
	const report = JSON.parse(
		await readFile(join(output, "report.json"), "utf8"),
	);
	expect(report.status).toBe("failed");
	expect(report.tokenUsage.totalTokens).toBe(
		["http", "network", "invalid JSON", "oversized"].includes(kind)
			? null
			: 150,
	);
	await expect(readFile(join(output, "cards.json"))).rejects.toThrow();
	if (kind === "invented evidence") {
		const unvalidated = JSON.parse(
			await readFile(join(output, "response-1.unvalidated.json"), "utf8"),
		);
		expect(unvalidated.cards[0].evidence).toEqual([{ cueId: 99 }]);
	}
});
