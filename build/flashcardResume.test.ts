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
	extractionStage,
	SELECTION_STAGE,
} from "../scripts/flashcards/checkpoints.ts";
import {
	type Card,
	chunks,
	extractionMessages,
	MAX_CANDIDATES_PER_SECTION,
	MAX_CHUNKS,
	MAX_INPUT_CHARACTERS,
	MODEL,
	sectionCoverage,
	selectionMessages,
	transcript,
	validateCards,
} from "../scripts/flashcards/core.ts";
import { runTrial } from "../scripts/flashcards/trial.ts";

const root = resolve("flashcard-trial.local");
const owned = new Set<string>();
let logs: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	logs = vi.spyOn(console, "log").mockImplementation(() => {});
	vi.stubEnv("ZAI_API_KEY", "");
});
afterEach(async () => {
	for (const call of logs.mock.calls) {
		const output = String(call[0]).split("\nOutput: ")[1];
		if (output?.startsWith(join(root, "run-"))) owned.add(output);
	}
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	for (const path of owned) await rm(path, { recursive: true, force: true });
	owned.clear();
});
function content(long = true) {
	return `WEBVTT\n\n${Array.from({ length: 18 }, (_, i) => `00:${String(i).padStart(2, "0")}.000 --> 00:${String(i + 1).padStart(2, "0")}.000\nConcept ${i + 1}.`).join("\n\n")}\n${long ? "\n00:20:00.000 --> 00:20:05.000\nSecond section concept.\n" : ""}`;
}
function modelCard(index = 0, cueId = 1) {
	return {
		question: `Question ${index + 1}?`,
		answer: `Answer ${index + 1}.`,
		extraContext: null,
		importance: 1,
		evidence: [{ cueId }],
	};
}
async function fixture(long = true) {
	await mkdir(root, { recursive: true });
	const run = await mkdtemp(join(root, "run-")),
		input = await mkdtemp(join(root, "input-resume-"));
	owned.add(run);
	owned.add(input);
	const text = content(long),
		path = join(input, "lesson.vtt"),
		cues = transcript(text),
		sections = chunks(cues);
	await writeFile(path, text);
	const response = {
		cards: Array.from({ length: 13 }, (_, index) => ({
			...modelCard(index),
			evidence: Array.from({ length: index === 0 ? 18 : 1 }, (_, i) => ({
				cueId: i + 1,
			})),
		})),
		notes: "Thirteen valid candidates.",
	};
	const report = {
		version: "flashcards-trial-4",
		model: MODEL,
		mode: "api",
		status: "failed",
		sourceSha256: createHash("sha256").update(text).digest("hex"),
		cueCount: cues.length,
		sections: sections.map((section) => ({
			firstCue: section[0].id,
			lastCue: section.at(-1)?.id,
		})),
		requests: [
			{
				stage: extractionStage(0),
				status: "received",
				usage: {
					promptTokens: 7377,
					completionTokens: 1890,
					totalTokens: 9267,
				},
			},
		],
	};
	await writeFile(join(run, "report.json"), JSON.stringify(report));
	await writeFile(
		join(run, "response-1.unvalidated.json"),
		JSON.stringify(response),
	);
	return { run, path, response, report };
}
async function saved(path: string, filename: string) {
	return JSON.parse(await readFile(join(path, filename), "utf8"));
}
function api(value: unknown) {
	return Response.json({
		model: MODEL,
		choices: [
			{ finish_reason: "stop", message: { content: JSON.stringify(value) } },
		],
		usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
	});
}
it("gives selection explicit section groups and requests distinct late concepts without equal quotas", () => {
	const sections = chunks(transcript(content()));
	const candidates = validateCards(
		{ cards: [modelCard(), modelCard(1, 19)], notes: "" },
		sections.flat(),
		2,
	).cards;
	const messages = selectionMessages(candidates, { min: 5, max: 12 }, sections);
	const request = JSON.parse(messages[1].content);
	expect(
		request.sections.map(
			(section: { candidateIds: number[] }) => section.candidateIds,
		),
	).toEqual([[1], [2]]);
	expect(request.task).toContain("EVERY chronological section");
	expect(request.task).toContain("Do not fill equal quotas");
	expect(request.task).toContain("same underlying answer");
	expect(request.task).toContain("different major topics");
});
it("reports chronological coverage without inventing topic labels or demanding filler", () => {
	const sections = chunks(transcript(content()));
	const candidates = validateCards(
		{ cards: [modelCard(), modelCard(1, 19)], notes: "" },
		sections.flat(),
		2,
	).cards;
	expect(sectionCoverage(candidates, [candidates[0]], sections)).toEqual([
		{ section: 1, available: 1, selected: 1 },
		{ section: 2, available: 1, selected: 0 },
	]);
	expect(sectionCoverage([], [], sections)).toEqual([
		{ section: 1, available: 0, selected: 0 },
		{ section: 2, available: 0, selected: 0 },
	]);
});
it("warns when a final selection omits a populated section without silently adding cards or making retries", async () => {
	const f = await fixture();
	vi.stubEnv("ZAI_API_KEY", "fake-test-secret");
	const fetcher = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(
			api({ cards: [modelCard(13, 19)], notes: "Useful late concept." }),
		)
		.mockResolvedValueOnce(
			api({ selectedIds: [1], notes: "Only an early card." }),
		);
	const output = await runTrial([f.path, "--resume", f.run, "--send"], fetcher);
	const report = await saved(output ?? "", "report.json");
	expect(report.coverage).toEqual([
		{ section: 1, available: 13, selected: 1 },
		{ section: 2, available: 1, selected: 0 },
	]);
	expect(
		report.notes.some((note: string) =>
			note.includes("Coverage review: section 2"),
		),
	).toBe(true);
	expect((await saved(output ?? "", "cards.json")).cards).toHaveLength(1);
	expect(fetcher).toHaveBeenCalledTimes(2);
});
it.each(["flashcards-trial-5", "flashcards-trial-7", "flashcards-trial-8"])(
	"keeps %s CLI checkpoint responses compatible without relabeling old content",
	async (version) => {
		const f = await fixture(),
			fetcher = vi.fn<typeof fetch>();
		await writeFile(
			join(f.run, "report.json"),
			JSON.stringify({ ...f.report, version }),
		);
		const output = await runTrial([f.path, "--resume", f.run], fetcher);
		const report = await saved(output ?? "", "report.json");
		expect(report.version).toBe("flashcards-trial-9");
		expect(report.reusedRequests[0].originalPromptVersion).toBe(version);
		expect(fetcher).not.toHaveBeenCalled();
	},
);
it("asks for scoped lesson claims, useful non-repeated context and spoken evidence even when slides are mentioned", () => {
	const system = extractionMessages(transcript(content(false)), 7, {
		min: 3,
		max: 7,
	})[0].content;
	expect(system).toContain("qualifiers in BOTH question and answer");
	expect(system).toContain("never assume a provider or universal default");
	expect(system).toContain("Do not repeat the answer in extraContext");
	expect(system).toContain("A mere mention of a slide");
});
it("resume records duplicate normalization while preserving the original raw response", async () => {
	const f = await fixture();
	f.response.cards[6].evidence = [{ cueId: 1 }, { cueId: 2 }, { cueId: 1 }];
	const raw = JSON.stringify(f.response);
	await writeFile(join(f.run, "response-1.unvalidated.json"), raw);
	const fetcher = vi.fn<typeof fetch>();
	const output = await runTrial([f.path, "--resume", f.run], fetcher);
	const report = await saved(output ?? "", "report.json");
	expect(report.validatorVersion).toBe("flashcards-validator-7");
	expect(report.normalizations).toEqual([
		{
			section: 1,
			duplicateReferencesRemoved: 1,
			cardsAffected: 1,
			detailsFile: "section-1.normalizations.json",
		},
	]);
	expect(await saved(output ?? "", "section-1.normalizations.json")).toEqual([
		{ cardIndex: 6, cueId: 1, removed: 1 },
	]);
	expect(
		(await saved(output ?? "", "section-1.json"))[6].evidence.map(
			(row: { cueId: number }) => row.cueId,
		),
	).toEqual([1, 2]);
	expect(
		await readFile(join(f.run, "response-1.unvalidated.json"), "utf8"),
	).toBe(raw);
	expect(
		await readFile(join(output ?? "", "reused-1.unvalidated.json"), "utf8"),
	).toBe(raw);
	expect(fetcher).not.toHaveBeenCalled();
});
it("fresh extraction also records normalized references but retains the raw API content", async () => {
	const f = await fixture(false);
	vi.stubEnv("ZAI_API_KEY", "fake-test-secret");
	const duplicate = { ...modelCard(), evidence: [{ cueId: 1 }, { cueId: 1 }] };
	const fetcher = vi
		.fn<typeof fetch>()
		.mockResolvedValue(api({ cards: [duplicate], notes: "" }));
	const output = await runTrial([f.path, "--send"], fetcher);
	expect(fetcher).toHaveBeenCalledOnce();
	expect(
		(await saved(output ?? "", "cards.json")).cards[0].evidence,
	).toHaveLength(1);
	expect(
		(await saved(output ?? "", "response-1.unvalidated.json")).cards[0]
			.evidence,
	).toHaveLength(2);
	expect(
		(await saved(output ?? "", "report.json")).normalizations[0]
			.duplicateReferencesRemoved,
	).toBe(1);
});
it("revalidates 13 candidates and all 18 citations in a resume dry run, without credentials or network", async () => {
	const f = await fixture(),
		fetcher = vi.fn<typeof fetch>();
	const originals = await Promise.all(
		["report.json", "response-1.unvalidated.json"].map((name) =>
			readFile(join(f.run, name), "utf8"),
		),
	);
	const output = await runTrial([f.path, "--resume", f.run], fetcher);
	expect(fetcher).not.toHaveBeenCalled();
	const section = await saved(output ?? "", "section-1.json");
	expect(section).toHaveLength(13);
	expect(section[0].evidence).toHaveLength(18);
	expect(section[0].evidence[17].quote).toBe("Concept 18.");
	const report = await saved(output ?? "", "report.json");
	expect(report.limits.maximumRequests).toBe(2);
	expect(report.requests).toEqual([]);
	expect(report.reusedRequests[0]).toMatchObject({
		originalPromptVersion: "flashcards-trial-4",
		usage: { totalTokens: 9267 },
	});
	expect(report.tokenUsage.totalTokens).toBeNull();
	expect(report.candidateCounts[0]).toEqual({
		section: 1,
		requested: 12,
		received: 13,
		reused: true,
	});
	expect(
		await Promise.all(
			["report.json", "response-1.unvalidated.json"].map((name) =>
				readFile(join(f.run, name), "utf8"),
			),
		),
	).toEqual(originals);
});
it("resumes missing sections only, keeps reused usage separate, and can resume a resumed run offline", async () => {
	const f = await fixture();
	const prepared = await runTrial([f.path, "--resume", f.run]);
	vi.stubEnv("ZAI_API_KEY", "fake-test-secret");
	const fetcher = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(
			api({ cards: [modelCard(13, 19)], notes: "Second section." }),
		)
		.mockResolvedValueOnce(
			api({ selectedIds: [14, 1], notes: "Distinct topics." }),
		);
	const output = await runTrial(
		[f.path, "--resume", prepared ?? "", "--send"],
		fetcher,
	);
	expect(fetcher).toHaveBeenCalledTimes(2);
	const sent = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
	expect(JSON.parse(sent.messages[1].content).transcript[0].cueId).toBe(19);
	const report = await saved(output ?? "", "report.json");
	expect(report.requests.map((r: { stage: string }) => r.stage)).toEqual([
		extractionStage(1),
		SELECTION_STAGE,
	]);
	expect(report.tokenUsage.totalTokens).toBe(300);
	expect(report.reusedRequests[0].usage.totalTokens).toBe(9267);
	expect((await saved(output ?? "", "cards.json")).cards[0].question).toBe(
		"Question 14?",
	);
	vi.stubEnv("ZAI_API_KEY", "");
	const noNetwork = vi.fn<typeof fetch>();
	const again = await runTrial(
		[f.path, "--resume", output ?? "", "--send"],
		noNetwork,
	);
	expect(noNetwork).not.toHaveBeenCalled();
	expect((await saved(again ?? "", "report.json")).limits.maximumRequests).toBe(
		0,
	);
	expect((await saved(again ?? "", "report.json")).reusedRequests).toHaveLength(
		3,
	);
	expect(await saved(again ?? "", "cards.json")).toEqual(
		await saved(output ?? "", "cards.json"),
	);
});
it("uses selection rather than truncating surplus candidates for a short lesson", async () => {
	const f = await fixture(false);
	vi.stubEnv("ZAI_API_KEY", "fake-test-secret");
	const fetcher = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(
			api({ selectedIds: [13, 1], notes: "Strongest two." }),
		);
	const output = await runTrial([f.path, "--resume", f.run, "--send"], fetcher);
	expect(fetcher).toHaveBeenCalledOnce();
	const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
	expect(JSON.parse(request.messages[1].content).candidates).toHaveLength(13);
	expect((await saved(output ?? "", "cards.json")).cards[0].question).toBe(
		"Question 13?",
	);
	expect(await saved(output ?? "", "section-1.json")).toHaveLength(13);
});
it("fresh extraction also accepts bounded surplus and then selects the final count", async () => {
	const f = await fixture(false);
	vi.stubEnv("ZAI_API_KEY", "fake-test-secret");
	const fetcher = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(api(f.response))
		.mockResolvedValueOnce(
			api({ selectedIds: [13], notes: "One strong concept." }),
		);
	const output = await runTrial([f.path, "--send"], fetcher);
	expect(fetcher).toHaveBeenCalledTimes(2);
	expect(await saved(output ?? "", "section-1.json")).toHaveLength(13);
	expect((await saved(output ?? "", "cards.json")).cards).toHaveLength(1);
});
it("retains hard candidate and citation limits and does not hide invalid surplus references", () => {
	const cues = transcript(content());
	const tooMany = Array.from(
		{ length: MAX_CANDIDATES_PER_SECTION + 1 },
		(_, i) => modelCard(i),
	);
	expect(() =>
		validateCards(
			{ cards: tooMany, notes: "" },
			cues,
			MAX_CANDIDATES_PER_SECTION,
		),
	).toThrow("card count");
	const valid = Array.from({ length: 13 }, (_, i) => modelCard(i));
	valid[12].evidence = [{ cueId: 999 }];
	expect(() =>
		validateCards(
			{ cards: valid, notes: "" },
			cues,
			MAX_CANDIDATES_PER_SECTION,
		),
	).toThrow("outside this transcript");
});
it.each([
	"changed transcript",
	"changed boundaries",
	"wrong model",
	"unknown evidence",
	"failed request",
	"missing response",
	"unsafe filename",
	"duplicate stage",
	"out-of-order stage",
	"changed response hash",
	"malformed card",
])("resume rejects %s before network access", async (kind) => {
	const f = await fixture(),
		fetcher = vi.fn<typeof fetch>();
	vi.stubEnv("ZAI_API_KEY", "fake-test-secret");
	const report: Record<string, unknown> = { ...f.report };
	if (kind === "changed transcript") await writeFile(f.path, `${content()}\n`);
	if (kind === "changed boundaries")
		report.sections = [{ firstCue: 2, lastCue: 18 }];
	if (kind === "wrong model") report.model = "wrong";
	if (kind === "failed request")
		report.requests = [{ ...f.report.requests[0], status: "failed" }];
	if (kind === "missing response")
		await rm(join(f.run, "response-1.unvalidated.json"));
	if (kind === "unsafe filename")
		report.requests = [
			{ ...f.report.requests[0], responseFile: "../report.json" },
		];
	if (kind === "duplicate stage")
		report.requests = [f.report.requests[0], f.report.requests[0]];
	if (kind === "out-of-order stage")
		report.requests = [{ ...f.report.requests[0], stage: extractionStage(1) }];
	if (kind === "changed response hash")
		report.requests = [
			{ ...f.report.requests[0], responseSha256: "0".repeat(64) },
		];
	if (kind === "unknown evidence" || kind === "malformed card")
		await writeFile(
			join(f.run, "response-1.unvalidated.json"),
			JSON.stringify({
				cards: [
					{
						...modelCard(),
						...(kind === "unknown evidence"
							? { evidence: [{ cueId: 999 }] }
							: { answer: "" }),
					},
				],
				notes: "",
			}),
		);
	await writeFile(join(f.run, "report.json"), JSON.stringify(report));
	await expect(
		runTrial([f.path, "--resume", f.run, "--send"], fetcher),
	).rejects.toThrow();
	expect(fetcher).not.toHaveBeenCalled();
});
it("bounds the actual escaped selection request while preserving every candidate and original card", () => {
	const card: Card = {
		question: "Question ".repeat(30),
		answer: '\\"\n🌍'.repeat(200),
		extraContext: "outside",
		importance: 1,
		evidence: [{ cueId: 1, quote: "source ".repeat(1000) }],
	};
	const cards = Array.from(
		{ length: MAX_CHUNKS * MAX_CANDIDATES_PER_SECTION },
		(_, index) => ({ ...card, question: `${index} ${card.question}` }),
	);
	const before = JSON.stringify(cards);
	const messages = selectionMessages(cards, { min: 10, max: 25 });
	expect(JSON.stringify(messages).length).toBeLessThanOrEqual(
		MAX_INPUT_CHARACTERS,
	);
	const selection = JSON.parse(messages[1].content);
	expect(selection.previewsTruncated).toBe(true);
	expect(selection.candidates.map((c: { id: number }) => c.id)).toEqual(
		cards.map((_, i) => i + 1),
	);
	expect(selection.candidates[0]).not.toHaveProperty("evidence");
	expect(selection.candidates[0].extraContext).toBe("outside");
	expect(selection.task).toContain(
		"AI-added background, not independently verified",
	);
	expect(selection.candidates[0].answer).toMatch(/…$/);
	expect(JSON.stringify(cards)).toBe(before);
	const complete = JSON.parse(
		selectionMessages([card], { min: 3, max: 7 })[1].content,
	);
	expect(complete.previewsTruncated).toBe(false);
	expect(complete.candidates[0].answer).toBe(card.answer);
	const rich = cards.map((candidate) => ({
		...candidate,
		extraContext: '\\"\n🌍'.repeat(180),
	}));
	const richBefore = JSON.stringify(rich);
	const richMessages = selectionMessages(rich, { min: 10, max: 25 });
	expect(JSON.stringify(richMessages).length).toBeLessThanOrEqual(
		MAX_INPUT_CHARACTERS,
	);
	expect(JSON.parse(richMessages[1].content).candidates).toHaveLength(
		cards.length,
	);
	expect(JSON.stringify(rich)).toBe(richBefore);
});
it("invalid resume options never issue a request", async () => {
	const fetcher = vi.fn<typeof fetch>();
	for (const args of [
		["lesson.vtt", "--resume"],
		["lesson.vtt", "--resume", "one", "--resume", "two"],
		["lesson.vtt", "--surprise"],
	])
		await expect(runTrial(args, fetcher)).rejects.toThrow();
	expect(fetcher).not.toHaveBeenCalled();
});
// File symlink creation is privileged on Windows.
it.skipIf(process.platform === "win32")(
	"resume rejects aliases and linked response files",
	async () => {
		const f = await fixture(),
			fetcher = vi.fn<typeof fetch>();
		const alias = join(root, `${basename(f.run)}Alias`);
		owned.add(alias);
		await symlink(f.run, alias, "junction");
		await expect(
			runTrial([f.path, "--resume", alias], fetcher),
		).rejects.toThrow("regular run directory");
		await rm(join(f.run, "response-1.unvalidated.json"));
		await symlink(f.path, join(f.run, "response-1.unvalidated.json"));
		await expect(
			runTrial([f.path, "--resume", f.run], fetcher),
		).rejects.toThrow("regular files");
		expect(fetcher).not.toHaveBeenCalled();
		expect((await readdir(f.run)).sort()).toEqual([
			"report.json",
			"response-1.unvalidated.json",
		]);
	},
);
