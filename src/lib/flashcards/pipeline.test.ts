import { expect, it, vi } from "vitest";
import {
	MAX_EXTRA_CONTEXT_CHARACTERS,
	MODEL,
	PROMPT_VERSION,
	VALIDATOR_VERSION,
	validateCards,
} from "@/lib/flashcards/core";
import {
	canResume,
	generate,
	inspectRecovery,
	type Preparation,
	plan,
	type Reply,
	remainingRequests,
	type Source,
	validateEdit,
	validateReceived,
} from "@/lib/flashcards/pipeline";

const source: Source = {
	content:
		"WEBVTT\n\n00:00:00.000 --> 00:00:10.000\nRecursion calls itself with a smaller problem.\n\n00:20:00.000 --> 00:20:10.000\nA base case terminates recursion.\n",
	filename: "lesson.en.vtt",
	sourceHash: "b".repeat(64),
	sourceFingerprint: "c".repeat(64),
};
const short = { ...source, content: source.content.split("\n\n00:20")[0] };
function reply(value: unknown): Reply {
	return {
		content: JSON.stringify(value),
		model: MODEL,
		finishReason: "stop",
		usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
	};
}
const card = (cueId: number) => ({
	question: `Question ${cueId}?`,
	answer: `Answer ${cueId}`,
	extraContext: null,
	importance: 1,
	evidence: [{ cueId }],
});
const section = (cueId: number) => reply({ cards: [card(cueId)], notes: "" });
const selection = reply({ selectedIds: [2, 1], notes: "Cover both concepts." });
function preparation(): Preparation {
	return {
		id: "a".repeat(64),
		source,
		checkpointError: null,
		resume: {
			resumable: true,
			replies: [section(1)],
			checkpoint: {
				version: 1,
				id: "a".repeat(64),
				lesson: { courseId: 1, lessonId: 2, relativePath: "lesson.mp4" },
				sourceHash: source.sourceHash,
				sourceFingerprint: source.sourceFingerprint,
				model: MODEL,
				promptVersion: PROMPT_VERSION,
				validatorVersion: VALIDATOR_VERSION,
				sections: plan(source).bounds,
				requests: [
					{ stage: "section-1", status: "received", hash: "d".repeat(64) },
				],
			},
		},
	};
}

function received(replies: Reply[]) {
	const prepared = preparation();
	prepared.source = structuredClone(prepared.source);
	if (!prepared.resume) throw new Error("fixture");
	prepared.resume.replies = replies;
	prepared.resume.checkpoint.requests = replies.map((_, index) => ({
		stage:
			index < plan(source).sections.length
				? `section-${index + 1}`
				: "selection",
		status: "received",
		hash: "d".repeat(64),
	}));
	return { ...prepared, resume: prepared.resume };
}
it("reuses numeric evidence without rewriting replies or sending requests", async () => {
	const numeric = reply({ cards: [{ ...card(2), evidence: [2] }], notes: "" });
	const prepared = received([section(1), numeric, selection]);
	const before = structuredClone(prepared);
	const ask = vi.fn();
	expect(
		inspectRecovery(prepared, prepared.resume.checkpoint.lesson),
	).toBeNull();
	expect(remainingRequests(source, [section(1), numeric])).toBe(1);
	expect(remainingRequests(source, prepared.resume.replies)).toBe(0);
	const result = await generate(source, prepared.resume.replies, ask, () => {});
	expect(ask).not.toHaveBeenCalled();
	expect(prepared).toEqual(before);
	expect(result.cards[0]).toEqual({
		question: "Question 2?",
		answer: "Answer 2",
		extraContext: null,
		evidence: [
			{
				cueId: 2,
				quote: "A base case terminates recursion.",
				start: 1200,
				end: 1210,
			},
		],
	});
	expect(result.notes).toContain(
		"Section 2: normalized 1 numeric evidence references to cueId objects without changing IDs; original response retained.",
	);
	expect(result.usage.newRequests).toEqual([]);
	expect(result.usage.reusedRequests).toEqual(
		prepared.resume.replies.map((r) => r.usage),
	);
});
it("normalizes fresh mixed evidence before validating and deduplicating all entries", async () => {
	const value = {
		cards: [{ ...card(1), evidence: [1, { cueId: 1 }] }],
		notes: "",
	};
	// The core schema remains strict; only the in-app response boundary adapts shape.
	expect(() => validateCards(value, plan(short).cues, 32)).toThrow(
		"expected a JSON object",
	);
	const ask = vi.fn(async () => reply(value));
	const result = await generate(short, [], ask, () => {});
	expect(ask).toHaveBeenCalledOnce();
	expect(result.cards[0].evidence).toHaveLength(1);
	expect(result.notes).toEqual([
		"Section 1: normalized 1 numeric evidence references to cueId objects without changing IDs; original response retained.",
		"Section 1: repeated valid cue references were collapsed after validation.",
	]);
	expect(
		(await generate(short, [section(1)], vi.fn(), () => {})).notes,
	).toEqual([]);
});
it.each([
	"2",
	null,
	[],
	2.5,
	Number.MAX_SAFE_INTEGER + 1,
	-1,
	0,
	1,
	253,
	{ cueId: 2, quote: "unexpected" },
])(
	"does not repair invalid evidence beside numeric references: %j",
	async (invalid) => {
		const bad = reply({
			cards: [{ ...card(2), evidence: [2, invalid] }],
			notes: "",
		});
		const ask = vi.fn();
		await expect(
			generate(source, [section(1), bad], ask, () => {}),
		).rejects.toThrow();
		expect(ask).not.toHaveBeenCalled();
	},
);
it("preserves schema and count limits when normalizing evidence", () => {
	for (const value of [
		{ cards: [{ ...card(1), evidence: Array(33).fill(1) }], notes: "" },
		{ cards: Array(33).fill({ ...card(1), evidence: [1] }), notes: "" },
		{ cards: [{ ...card(1), evidence: [1], unknown: true }], notes: "" },
		{ cards: [{ ...card(1), evidence: [1] }], notes: "", unknown: true },
	]) {
		expect(() => validateReceived(short, [reply(value)])).toThrow();
	}
});
it.each([
	{
		name: "extra evidence fields",
		value: { ...card(2), evidence: [{ cueId: 2, quote: "unexpected" }] },
	},
	{ name: "string cue ID", value: { ...card(2), evidence: [{ cueId: "2" }] } },
	{
		name: "fractional cue ID",
		value: { ...card(2), evidence: [{ cueId: 2.5 }] },
	},
	{ name: "cross-section cue", value: card(1) },
])(
	"offers explicit recovery for $name without accepting the bad evidence",
	async ({ value }) => {
		const bad = reply({ cards: [value], notes: "" });
		const prepared = received([section(1), bad]);
		const identity = prepared.resume.checkpoint.lesson;
		const before = structuredClone(prepared);
		expect(inspectRecovery(prepared, identity)).toMatchObject({
			keep: 1,
			requests: 2,
		});
		expect(prepared).toEqual(before);
		const ask = vi.fn();
		await expect(
			generate(source, prepared.resume.replies, ask, () => {}),
		).rejects.toThrow();
		expect(ask).not.toHaveBeenCalled();
	},
);
it("keeps all extraction responses when only selection failed", async () => {
	const prepared = received([
		section(1),
		section(2),
		reply({ selectedIds: [1], notes: "", cards: [] }),
	]);
	const recovery = inspectRecovery(prepared, prepared.resume.checkpoint.lesson);
	expect(recovery).toMatchObject({ keep: 2, requests: 1 });
	if (!recovery) throw new Error("Expected recoverable selection");
	const ask = vi.fn(async (_stage: string) => selection);
	await generate(
		source,
		prepared.resume.replies.slice(0, recovery.keep),
		ask,
		() => {},
	);
	expect(ask).toHaveBeenCalledOnce();
	expect(ask.mock.calls[0]?.[0]).toBe("selection");
});
it.each([
	{
		finishReason: "length",
		model: MODEL,
		expected: "output limit reached (8,192 tokens)",
	},
	{ finishReason: "unknown", model: MODEL, expected: "incomplete output" },
	{ finishReason: "stop", model: "other-model", expected: "different model" },
])(
	"distinguishes $expected and offers received-only recovery",
	async ({ finishReason, model, expected }) => {
		const bad = { ...section(1), finishReason, model };
		const prepared = received([bad]);
		expect(
			inspectRecovery(prepared, prepared.resume.checkpoint.lesson),
		).toMatchObject({ keep: 0, reason: expect.stringContaining(expected) });
		await expect(generate(source, [bad], vi.fn(), () => {})).rejects.toThrow(
			expected,
		);
	},
);
it.each([`{"cards":[${"\n".repeat(38_445)}`, section(1).content])(
	"rejects token-limited cached output even if it resembles complete JSON",
	async (content) => {
		const cached = { ...section(1), content, finishReason: "length" };
		const before = structuredClone(cached);
		const ask = vi.fn();
		await expect(generate(short, [cached], ask, () => {})).rejects.toThrow(
			"Provider output limit reached (8,192 tokens)",
		);
		expect(ask).not.toHaveBeenCalled();
		expect(cached).toEqual(before);
	},
);
it("rejects fresh token-limited output without another request", async () => {
	const ask = vi.fn(async () => ({ ...section(1), finishReason: "length" }));
	await expect(generate(short, [], ask, () => {})).rejects.toThrow(
		"retry requires explicit confirmation",
	);
	expect(ask).toHaveBeenCalledOnce();
});
it("requires explicit start-over for prompt 8 native checkpoints", () => {
	const prepared = received([section(1)]);
	prepared.resume.checkpoint.promptVersion = "flashcards-trial-8";
	expect(canResume(prepared, prepared.resume.checkpoint.lesson)).toBe(false);
	expect(
		inspectRecovery(prepared, prepared.resume.checkpoint.lesson),
	).toBeNull();
});
it("does not recover uncertain, changed, corrupt or old-version checkpoints", () => {
	for (const change of [
		(p: ReturnType<typeof received>) => {
			p.resume.resumable = false;
		},
		(p: ReturnType<typeof received>) => {
			p.source.sourceHash = "changed";
		},
		(p: ReturnType<typeof received>) => {
			p.source.sourceFingerprint = "changed";
		},
		(p: ReturnType<typeof received>) => {
			p.resume.checkpoint.promptVersion = "old";
		},
		(p: ReturnType<typeof received>) => {
			p.checkpointError = "corrupt";
		},
		(p: ReturnType<typeof received>) => {
			p.resume.checkpoint.requests[0].status = "started";
		},
	]) {
		const prepared = received([reply({})]);
		change(prepared);
		expect(
			inspectRecovery(prepared, prepared.resume.checkpoint.lesson),
		).toBeNull();
	}
});
it("reuses received stages, selects across the entire lesson and derives evidence locally", async () => {
	const ask = vi
		.fn()
		.mockResolvedValueOnce(section(2))
		.mockResolvedValueOnce(selection);
	const result = await generate(source, [section(1)], ask, () => {});
	expect(ask.mock.calls.map(([stage]) => stage)).toEqual([
		"section-2",
		"selection",
	]);
	expect(result.cards[0].evidence[0]).toEqual({
		cueId: 2,
		quote: "A base case terminates recursion.",
		start: 1200,
		end: 1210,
	});
	expect(result.usage.newRequests).toHaveLength(2);
	expect(result.usage.reusedRequests).toHaveLength(1);
});
it("rejects every cached bad reference before sending another paid request", async () => {
	const ask = vi.fn();
	await expect(
		generate(source, [section(1), section(999)], ask, () => {}),
	).rejects.toThrow("outside this transcript section");
	expect(ask).not.toHaveBeenCalled();
});
it("sends only explicit global cue labels/text, keeping original times for local evidence", async () => {
	const ask = vi.fn(async (stage, messages) => {
		if (stage === "selection") return selection;
		const payload = JSON.parse(messages[1].content);
		const cueId = stage === "section-1" ? 1 : 2;
		expect(payload.transcript).toEqual([
			{
				cueId,
				text:
					cueId === 1
						? "Recursion calls itself with a smaller problem."
						: "A base case terminates recursion.",
			},
		]);
		expect(payload.allowedCueIds).toEqual([cueId]);
		expect(payload.shape.cards[0].evidence).toEqual([{ cueId }]);
		return section(cueId);
	});
	await generate(source, [], ask, () => {});
	expect(ask).toHaveBeenCalledTimes(3);
});
it("retains full longer AI explanations, shows selection only a bounded preview and adds no API stage", async () => {
	const context = "A focused illustrative example. ".repeat(35).trim();
	const ask = vi.fn(async (stage, messages) => {
		if (stage === "selection") {
			const request = JSON.parse(messages[1].content);
			expect(request.candidates[0].extraContext).toHaveLength(480);
			expect(request.previewsTruncated).toBe(true);
			return selection;
		}
		return reply({
			cards: [
				{ ...card(stage === "section-1" ? 1 : 2), extraContext: context },
			],
			notes: "",
		});
	});
	const result = await generate(source, [], ask, () => {});
	expect(ask.mock.calls.map(([stage]) => stage)).toEqual([
		"section-1",
		"section-2",
		"selection",
	]);
	expect(result.cards[0].extraContext).toBe(context);
	expect(result.cards[0].answer).toBe("Answer 2");
	expect(result.cards[0].evidence[0].quote).toBe(
		"A base case terminates recursion.",
	);
});
it("rejects timestamps and cross-section IDs without remapping, dropping cards or retrying", async () => {
	const ask = vi.fn().mockResolvedValue(section(1200));
	await expect(generate(source, [section(1)], ask, () => {})).rejects.toThrow(
		"Section 2: response.cards[0].evidence[0].cueId: references a cue outside",
	);
	expect(ask).toHaveBeenCalledOnce();
	const cachedAsk = vi.fn();
	await expect(
		generate(source, [section(1), section(1)], cachedAsk, () => {}),
	).rejects.toThrow("Section 2:");
	expect(cachedAsk).not.toHaveBeenCalled();
});
it("can finish a received single-section result without a key or any API call", async () => {
	const ask = vi.fn();
	expect(remainingRequests(short, [section(1)])).toBe(0);
	const result = await generate(short, [section(1)], ask, () => {});
	expect(ask).not.toHaveBeenCalled();
	expect(result.cards).toHaveLength(1);
	expect(result.usage.newRequests).toEqual([]);
});
it("reuses a completed selection, rejects truncated output, and never repairs via another API call", async () => {
	const ask = vi.fn();
	const result = await generate(
		source,
		[section(1), section(2), selection],
		ask,
		() => {},
	);
	expect(result.cards.map((row) => row.question)).toEqual([
		"Question 2?",
		"Question 1?",
	]);
	expect(ask).not.toHaveBeenCalled();
	await expect(
		generate(short, [{ ...section(1), finishReason: "length" }], ask, () => {}),
	).rejects.toThrow("incomplete");
	await expect(
		generate(short, [{ ...section(1), content: "not JSON" }], ask, () => {}),
	).rejects.toThrow("invalid card JSON");
});
it("accepts zero substantive cards without inventing filler or a selection request", async () => {
	const ask = vi
		.fn()
		.mockResolvedValue(
			reply({ cards: [], notes: "Only introductory material." }),
		);
	const result = await generate(short, [], ask, () => {});
	expect(result.cards).toEqual([]);
	expect(ask).toHaveBeenCalledTimes(1);
	expect(result.notes).toContain("Only introductory material.");
});
it("cancellation stops after a response without selecting or saving more work", async () => {
	let cancelled = false;
	const ask = vi.fn(async () => {
		cancelled = true;
		return section(1);
	});
	await expect(
		generate(source, [], ask, () => {
			if (cancelled) throw new Error("Cancelled");
		}),
	).rejects.toThrow("Cancelled");
	expect(ask).toHaveBeenCalledTimes(1);
});
it("resume binds source, identity, versions, exact section boundaries and received sequence", () => {
	const input = preparation(),
		identity = { courseId: 1, lessonId: 2, relativePath: "lesson.mp4" };
	expect(canResume(input, identity)).toBe(true);
	expect(canResume(input, { ...identity, lessonId: 3 })).toBe(false);
	for (const patch of [
		{ sourceHash: "changed" },
		{ sourceFingerprint: "changed" },
		{ model: "other" },
		{ promptVersion: "old" },
		{
			promptVersion: "flashcards-trial-7",
			validatorVersion: "flashcards-validator-6",
		},
		{ sections: [{ firstCue: 1, lastCue: 2 }] },
	]) {
		const changed = preparation();
		if (!changed.resume) throw new Error("fixture");
		Object.assign(changed.resume.checkpoint, patch);
		expect(canResume(changed, identity)).toBe(false);
	}
	if (input.resume) input.resume.resumable = false;
	expect(canResume(input, identity)).toBe(false);
});
it("bounds transcript sizes and validates edits without allowing empty or unbounded text", () => {
	expect(() =>
		plan({ ...short, content: "x".repeat(2 * 1024 * 1024 + 1) }),
	).toThrow("2 MiB");
	expect(validateEdit(" Question? ", " Answer ", " ")).toEqual({
		question: "Question?",
		answer: "Answer",
		extraContext: null,
	});
	expect(() => validateEdit(" ", "answer", null)).toThrow();
	expect(() => validateEdit("Question", "x".repeat(1501), null)).toThrow();
	expect(
		validateEdit("Question", "Answer", "x".repeat(MAX_EXTRA_CONTEXT_CHARACTERS))
			.extraContext,
	).toHaveLength(MAX_EXTRA_CONTEXT_CHARACTERS);
	expect(() =>
		validateEdit(
			"Question",
			"Answer",
			"x".repeat(MAX_EXTRA_CONTEXT_CHARACTERS + 1),
		),
	).toThrow("1200");
});
