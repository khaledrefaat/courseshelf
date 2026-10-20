import { expect, it, vi } from "vitest";
import {
	BatchStopped,
	CourseFlashcardQueue,
	type CourseQueueDependencies,
	type PreparedLesson,
} from "@/features/flashcards/courseQueue";
import {
	MODEL,
	PROMPT_VERSION,
	VALIDATOR_VERSION,
} from "@/lib/flashcards/core";
import type { Reply } from "@/lib/flashcards/pipeline";

const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
function input(id: number): PreparedLesson {
	return {
		identity: {
			courseId: 1,
			lessonId: id,
			relativePath: `${id}.mp4`,
			rootPath: "/course",
			lessonCreated: "created",
			courseCreated: "created",
		},
		prepared: {
			id: `preparation-${id}`,
			source: {
				content:
					"WEBVTT\n\n00:00:00.000 --> 00:00:10.000\nRecursion requires a base case.\n",
				filename: `${id}.vtt`,
				sourceHash: `hash-${id}`,
				sourceFingerprint: `fingerprint-${id}`,
			},
			resume: null,
			checkpointError: null,
		},
	};
}
function checkpoint(prepared: PreparedLesson) {
	const reply: Reply = {
		content: JSON.stringify({ cards: [], notes: "Intro only" }),
		model: MODEL,
		finishReason: "stop",
		usage,
	};
	prepared.prepared.resume = {
		resumable: true,
		replies: [reply],
		checkpoint: {
			version: 1,
			id: "checkpoint",
			lesson: prepared.identity,
			sourceHash: prepared.prepared.source.sourceHash,
			sourceFingerprint: prepared.prepared.source.sourceFingerprint,
			model: MODEL,
			promptVersion: PROMPT_VERSION,
			validatorVersion: VALIDATOR_VERSION,
			sections: [{ firstCue: 1, lastCue: 1 }],
			requests: [
				{ stage: "section-1", status: "received", hash: "response-hash" },
			],
		},
	};
}
function fixture(count = 3) {
	const sources = new Map(
		Array.from({ length: count }, (_, i) => [i + 1, input(i + 1)]),
	);
	const saved = new Map<
		number,
		{ sourceHash: string; sourceFingerprint: string }
	>();
	let reserved = false,
		epoch = 0,
		inFlight = 0,
		peak = 0;
	const deps: CourseQueueDependencies = {
		reserve: vi.fn(() => {
			if (reserved) throw new Error("reserved");
			reserved = true;
			return Symbol();
		}),
		release: vi.fn(() => {
			reserved = false;
		}),
		guard: () => {
			const original = epoch;
			return () => {
				if (epoch !== original) throw new Error("Course changed");
			};
		},
		lessons: vi.fn(async () =>
			[...sources.keys()].map((id) => ({ id, title: `Lesson ${id}` })),
		),
		saved: vi.fn(async (id) => saved.get(id) ?? null),
		prepare: vi.fn(async (_course, id) => {
			const result = sources.get(id);
			if (!result) throw new Error("No transcript");
			return structuredClone(result);
		}),
		generate: vi.fn(async (prepared, _resume, _owner, observer) => {
			inFlight++;
			peak = Math.max(peak, inFlight);
			observer.check();
			for (const reply of prepared.prepared.resume?.replies ?? [])
				observer.reply(reply.usage, true);
			if (!prepared.prepared.resume) {
				observer.request();
				await Promise.resolve();
				observer.check();
				observer.reply(usage, false);
			}
			saved.set(prepared.identity.lessonId, prepared.prepared.source);
			observer.saved();
			inFlight--;
		}),
	};
	const queue = new CourseFlashcardQueue(deps);
	const preview = (signal = new AbortController().signal) =>
		queue.prepare(1, "Course", signal, () => {});
	return {
		queue,
		deps,
		sources,
		saved,
		preview,
		invalidate: () => {
			epoch++;
		},
		peak: () => peak,
	};
}
it("previews read-only, keeps metadata only, and reprepares more than eight lessons sequentially", async () => {
	const f = fixture(12),
		plan = await f.preview();
	expect(f.deps.generate).not.toHaveBeenCalled();
	expect(f.deps.reserve).not.toHaveBeenCalled();
	expect(JSON.stringify(plan)).not.toContain("Recursion requires");
	expect(plan.maximumRequests).toBe(24); // conservative extraction + optional selection per lesson
	await f.queue.start(plan);
	expect(f.deps.prepare).toHaveBeenCalledTimes(24);
	expect(f.peak()).toBe(1);
	expect(
		vi
			.mocked(f.deps.generate)
			.mock.calls.map(([prepared]) => prepared.identity.lessonId),
	).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
	expect(f.queue.getSnapshot()).toMatchObject({
		generated: 12,
		requests: 12,
		newTokens: 180,
		unknownUsage: 0,
		running: false,
	});
});
it("skips saved/empty/edited sets and reports outdated sources without overwriting them", async () => {
	const f = fixture();
	f.saved.set(1, { sourceHash: "old", sourceFingerprint: "old" });
	f.saved.set(2, input(2).prepared.source);
	const before = new Map(f.saved),
		plan = await f.preview();
	expect(plan.items[0].reason).toContain("outdated");
	expect(plan.items[1].status).toBe("saved");
	await f.queue.start(plan);
	expect(f.deps.generate).toHaveBeenCalledTimes(1);
	expect(f.saved.get(1)).toEqual(before.get(1));
	expect(f.saved.get(2)).toEqual(before.get(2));
	expect(f.queue.getSnapshot()).toMatchObject({ skipped: 2, generated: 1 });
});
it("reuses fully received zero-card work without new requests and skips malformed/uncertain checkpoints", async () => {
	const f = fixture(4);
	for (const id of [1, 2, 3]) checkpoint(f.sources.get(id) as PreparedLesson);
	const second = f.sources.get(2) as PreparedLesson,
		third = f.sources.get(3) as PreparedLesson;
	if (!second.prepared.resume || !third.prepared.resume)
		throw new Error("fixture");
	second.prepared.resume.replies[0].content = "{}";
	third.prepared.resume.resumable = false;
	const fourth = f.sources.get(4) as PreparedLesson;
	fourth.prepared.checkpointError = "Old prompt checkpoint kept";
	const plan = await f.preview();
	expect(plan.maximumRequests).toBe(0);
	expect(plan.items.map((item) => item.status)).toEqual([
		"ready",
		"issue",
		"issue",
		"issue",
	]);
	await f.queue.start(plan);
	expect(f.queue.getSnapshot()).toMatchObject({
		generated: 1,
		resumed: 1,
		skipped: 3,
		requests: 0,
		reusedTokens: 15,
	});
	expect(f.deps.generate).toHaveBeenCalledTimes(1);
});
it.each(["source", "checkpoint"])(
	"never silently expands confirmed upload scope when %s changes",
	async (kind) => {
		const f = fixture(1),
			plan = await f.preview();
		const source = f.sources.get(1) as PreparedLesson;
		if (kind === "source") source.prepared.source.sourceHash = "changed";
		else checkpoint(source);
		await f.queue.start(plan);
		expect(f.deps.generate).not.toHaveBeenCalled();
		expect(f.queue.getSnapshot()).toMatchObject({ failed: 1, requests: 0 });
		expect(f.queue.getSnapshot()?.errors[0]).toContain(
			"changed since confirmation",
		);
	},
);
it("skips sets saved after preview or during reprepare, before any API call", async () => {
	const f = fixture(2),
		plan = await f.preview();
	f.saved.set(1, input(1).prepared.source);
	vi.mocked(f.deps.prepare).mockImplementation(async (_course, id) => {
		f.saved.set(id, input(id).prepared.source);
		return input(id);
	});
	await f.queue.start(plan);
	expect(f.deps.generate).not.toHaveBeenCalled();
	expect(f.queue.getSnapshot()?.skipped).toBe(2);
});
it("enforces the per-lesson and whole-course request ceiling before extra sends", async () => {
	const f = fixture(),
		plan = await f.preview();
	const sent = vi.fn();
	vi.mocked(f.deps.generate).mockImplementation(
		async (_input, _resume, _owner, observer) => {
			for (let i = 0; i < 3; i++) {
				observer.request();
				sent();
				observer.reply(usage, false);
			}
		},
	);
	await f.queue.start(plan);
	expect(sent).toHaveBeenCalledTimes(2);
	expect(f.queue.getSnapshot()).toMatchObject({
		stopped: true,
		failed: 1,
		requests: 2,
	});
	expect(f.deps.release).toHaveBeenCalledTimes(1);
});
it("continues lesson validation failures without retry, but stops native request failures and preserves unknown usage", async () => {
	const f = fixture(4),
		plan = await f.preview();
	vi.mocked(f.deps.generate).mockImplementation(
		async (prepared, _resume, _owner, observer) => {
			observer.request();
			if (prepared.identity.lessonId === 2)
				throw new BatchStopped("HTTP 429; usage unknown");
			observer.reply(usage, false);
			throw new Error("Malformed card evidence; received response kept");
		},
	);
	await f.queue.start(plan);
	expect(f.deps.generate).toHaveBeenCalledTimes(2);
	expect(f.queue.getSnapshot()).toMatchObject({
		failed: 2,
		stopped: true,
		processed: 2,
		requests: 2,
		newTokens: 15,
		unknownUsage: 1,
	});
});
it("cancels and drains an in-flight operation, keeps the reservation through gaps, then permits rerun", async () => {
	const f = fixture(),
		plan = await f.preview();
	let release: (() => void) | undefined;
	vi.mocked(f.deps.prepare).mockImplementation(async (_course, id) => {
		await new Promise<void>((resolve) => {
			release = resolve;
		});
		return input(id);
	});
	const task = f.queue.start(plan);
	await vi.waitFor(() => expect(release).toBeTypeOf("function"));
	await expect(f.queue.start(plan)).rejects.toThrow("active");
	expect(f.deps.release).not.toHaveBeenCalled();
	expect(f.queue.cancel(999)).toBeUndefined();
	const drained = f.queue.cancel(1);
	f.queue.dismiss(); // cannot erase a live run
	expect(f.queue.getSnapshot()?.running).toBe(true);
	release?.();
	await drained;
	await task;
	expect(f.deps.generate).not.toHaveBeenCalled();
	expect(f.queue.getSnapshot()).toMatchObject({
		cancelled: true,
		running: false,
	});
	expect(f.deps.release).toHaveBeenCalledTimes(1);
});
it("aborts previews and invalidates confirmed plans after management/close without reserving or paying", async () => {
	const f = fixture(),
		controller = new AbortController();
	controller.abort();
	await expect(f.preview(controller.signal)).rejects.toThrow("cancelled");
	const plan = await f.preview();
	f.invalidate();
	await expect(f.queue.start(plan)).rejects.toThrow("changed");
	expect(f.deps.reserve).not.toHaveBeenCalled();
	expect(f.deps.generate).not.toHaveBeenCalled();
});
it("reruns skip successes, and lessons added after confirmation are not uploaded", async () => {
	const f = fixture(1),
		plan = await f.preview();
	f.sources.set(2, input(2));
	await f.queue.start(plan);
	expect(f.deps.generate).toHaveBeenCalledTimes(1);
	const next = await f.preview();
	expect(next.items.map((item) => item.status)).toEqual(["saved", "ready"]);
});
