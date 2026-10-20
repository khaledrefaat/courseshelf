import { expect, it, vi } from "vitest";
import {
	MAX_EXTRA_CONTEXT_CHARACTERS,
	MODEL,
	PROMPT_VERSION,
	VALIDATOR_VERSION,
} from "@/lib/flashcards/core";
import {
	canResume,
	generate,
	type Preparation,
	plan,
	type Reply,
	remainingRequests,
	type Source,
	validateEdit,
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
