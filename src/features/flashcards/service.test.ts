import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	allowCourseFlashcards,
	cancelFlashcards,
	courseFlashcards,
	flashcardSnapshot,
	pauseCourseFlashcards,
	prepareFlashcards,
	sessionKey,
	startFlashcards,
	withFlashcardsPaused,
} from "@/features/flashcards/service";
import {
	flashcardLesson,
	flashcardStamp,
	saveFlashcards,
} from "@/lib/db/flashcards";
import { listByCourse } from "@/lib/db/lessons";
import {
	MODEL,
	PROMPT_VERSION,
	VALIDATOR_VERSION,
} from "@/lib/flashcards/core";
import { type Preparation, plan, type Reply } from "@/lib/flashcards/pipeline";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/lib/db/flashcards", () => ({
	flashcardLesson: vi.fn(),
	flashcardStamp: vi.fn(),
	saveFlashcards: vi.fn(),
}));
vi.mock("@/lib/db/generatedSubtitles", () => ({
	getGeneratedSubtitle: vi.fn(async () => null),
}));
vi.mock("@/lib/db/lessons", () => ({ listByCourse: vi.fn() }));
const identity = {
	courseId: 1,
	lessonId: 2,
	relativePath: "lesson.mp4",
	rootPath: "/course",
	lessonCreated: "created",
	courseCreated: "created",
};
const preparation: Preparation = {
	id: "a".repeat(64),
	source: {
		content:
			"WEBVTT\n\n00:00:00.000 --> 00:00:10.000\nA base case terminates recursion.\n",
		filename: "lesson.vtt",
		sourceHash: "b".repeat(64),
		sourceFingerprint: "c".repeat(64),
	},
	resume: null,
	checkpointError: null,
};
const reply: Reply = {
	content: JSON.stringify({
		cards: [
			{
				question: "What terminates recursion?",
				answer: "A base case.",
				extraContext: null,
				importance: 1,
				evidence: [{ cueId: 1 }],
			},
		],
		notes: "",
	}),
	model: MODEL,
	finishReason: "stop",
	usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
};
beforeEach(() => {
	vi.resetAllMocks();
	allowCourseFlashcards(1);
	courseFlashcards.dismiss();
	vi.mocked(flashcardStamp).mockResolvedValue(null);
	vi.mocked(flashcardLesson).mockResolvedValue(identity);
	vi.mocked(saveFlashcards).mockImplementation(
		async (_identity, _job, _source, _result, check) => check(),
	);
	vi.mocked(invoke).mockImplementation(async (command) => {
		if (command === "flashcards_prepare") return structuredClone(preparation);
		if (command === "flashcards_begin") return "native-job";
		if (command === "flashcards_request") return reply;
		if (command === "flashcards_key") return true;
		return undefined;
	});
});

function courseFixture() {
	vi.mocked(listByCourse).mockResolvedValue(
		[2, 3].map((id) => ({
			id,
			course_id: 1,
			title: `Lesson ${id}`,
			relative_path: `${id}.mp4`,
			sort_order: id,
			created_at: "created",
			missing_at: null,
		})),
	);
	vi.mocked(flashcardLesson).mockImplementation(
		async (_courseId, lessonId) => ({
			...identity,
			lessonId,
			relativePath: `${lessonId}.mp4`,
		}),
	);
	return courseFlashcards.prepare(
		1,
		"Course",
		new AbortController().signal,
		() => {},
	);
}

it("retries a failed course response only after explicit recovery, binds the native checkpoint and uses missing-only publication", async () => {
	const prepared = structuredClone(preparation);
	prepared.resume = {
		resumable: true,
		replies: [{ ...reply, content: "{}" }],
		checkpoint: {
			version: 1,
			id: "d".repeat(64),
			lesson: identity,
			sourceHash: prepared.source.sourceHash,
			sourceFingerprint: prepared.source.sourceFingerprint,
			model: MODEL,
			promptVersion: PROMPT_VERSION,
			validatorVersion: VALIDATOR_VERSION,
			sections: plan(prepared.source).bounds,
			requests: [
				{ stage: "section-1", status: "received", hash: "e".repeat(64) },
			],
		},
	};
	courseFixture();
	vi.mocked(listByCourse).mockResolvedValue([
		{
			id: 2,
			course_id: 1,
			title: "Failed lesson",
			relative_path: "lesson.mp4",
			sort_order: 1,
			created_at: "created",
			missing_at: null,
		},
	]);
	vi.mocked(flashcardLesson).mockResolvedValue(identity);
	vi.mocked(invoke).mockImplementation(async (command) => {
		if (command === "flashcards_prepare") return structuredClone(prepared);
		if (command === "flashcards_begin") return "retry-job";
		if (command === "flashcards_request") return reply;
	});
	const preview = await courseFlashcards.prepare(
		1,
		"Course",
		new AbortController().signal,
		() => {},
	);
	expect(preview.items[0].status).toBe("retry");
	expect(invoke).not.toHaveBeenCalledWith(
		"flashcards_begin",
		expect.anything(),
	);
	await courseFlashcards.start(preview);
	expect(saveFlashcards).not.toHaveBeenCalled();
	await courseFlashcards.start(preview, true);
	expect(invoke).toHaveBeenCalledWith("flashcards_begin", {
		preparedId: prepared.id,
		sections: plan(prepared.source).bounds,
		resume: true,
		retry: { checkpoint: prepared.resume.checkpoint, keep: 0 },
	});
	expect(
		vi
			.mocked(invoke)
			.mock.calls.filter(([command]) => command === "flashcards_request"),
	).toHaveLength(1);
	expect(vi.mocked(saveFlashcards).mock.calls[0][5]).toBe(true);
	expect(courseFlashcards.getSnapshot()).toMatchObject({
		excludedTokens: 15,
		newTokens: 15,
		reusedTokens: 0,
	});
	expect(invoke).toHaveBeenLastCalledWith("flashcards_finish", {
		jobId: "retry-job",
		saved: true,
	});
});

it.each(["cancel", "forget", "management"])(
	"holds the reservation between lessons and %s drains the whole course without starting another request",
	async (operation) => {
		const plan = await courseFixture();
		let release: ((value: Preparation) => void) | undefined;
		vi.mocked(invoke).mockImplementation(async (command, args) => {
			if (command === "flashcards_prepare") {
				const { lesson } = args as { lesson: { lessonId: number } };
				if (lesson.lessonId === 3)
					return new Promise<Preparation>((resolve) => {
						release = resolve;
					});
				return structuredClone(preparation);
			}
			if (command === "flashcards_begin") return "job";
			if (command === "flashcards_request") return reply;
			if (command === "flashcards_key") return false;
		});
		const work = courseFlashcards.start(plan);
		await vi.waitFor(() => expect(release).toBeTypeOf("function"));
		expect(flashcardSnapshot().job?.running).toBe(false);
		await expect(
			startFlashcards({ identity, prepared: preparation }, false),
		).rejects.toThrow("Another");
		const cancel =
			operation === "forget"
				? sessionKey("")
				: operation === "management"
					? pauseCourseFlashcards(1)
					: cancelFlashcards();
		expect(courseFlashcards.getSnapshot()?.cancelled).toBe(true);
		release?.(structuredClone(preparation));
		await cancel;
		await work;
		expect(saveFlashcards).toHaveBeenCalledTimes(1);
		expect(vi.mocked(saveFlashcards).mock.calls[0][5]).toBe(true);
		expect(
			vi
				.mocked(invoke)
				.mock.calls.filter(([cmd]) => cmd === "flashcards_request"),
		).toHaveLength(1);
		expect(courseFlashcards.getSnapshot()).toMatchObject({
			running: false,
			cancelled: true,
			generated: 1,
			requests: 1,
		});
		allowCourseFlashcards(1);
		await expect(courseFlashcards.start(plan)).rejects.toThrow("changed");
	},
);

it("counts received malformed replies, continues locally, and stops the course on native transport failure without retry", async () => {
	const plan = await courseFixture();
	let calls = 0;
	vi.mocked(invoke).mockImplementation(async (command) => {
		if (command === "flashcards_prepare") return structuredClone(preparation);
		if (command === "flashcards_begin") return "job";
		if (command === "flashcards_request") {
			if (++calls === 2)
				throw "Flashcard provider returned HTTP 401; usage may be unknown.";
			return { ...reply, content: "{}" };
		}
	});
	await courseFlashcards.start(plan);
	expect(calls).toBe(2);
	expect(saveFlashcards).not.toHaveBeenCalled();
	expect(courseFlashcards.getSnapshot()).toMatchObject({
		failed: 2,
		stopped: true,
		requests: 2,
		newTokens: 15,
		unknownUsage: 1,
	});
});

it("marks a set saved even if finalization fails, then stops before the next lesson", async () => {
	const plan = await courseFixture();
	vi.mocked(invoke).mockImplementation(async (command) => {
		if (command === "flashcards_prepare") return structuredClone(preparation);
		if (command === "flashcards_begin") return "job";
		if (command === "flashcards_request") return reply;
		if (command === "flashcards_finish")
			throw new Error("native finalization failed");
	});
	await courseFlashcards.start(plan);
	expect(saveFlashcards).toHaveBeenCalledTimes(1);
	expect(courseFlashcards.getSnapshot()).toMatchObject({
		generated: 1,
		failed: 1,
		stopped: true,
	});
});

it("close-style cancellation drains the active batch request and prevents every late save/next lesson", async () => {
	const plan = await courseFixture();
	let release: ((value: Reply) => void) | undefined;
	vi.mocked(invoke).mockImplementation(async (command) => {
		if (command === "flashcards_prepare") return structuredClone(preparation);
		if (command === "flashcards_begin") return "job";
		if (command === "flashcards_request")
			return new Promise<Reply>((resolve) => {
				release = resolve;
			});
	});
	const work = courseFlashcards.start(plan);
	await vi.waitFor(() => expect(release).toBeTypeOf("function"));
	let drained = false;
	const closing = cancelFlashcards().then(() => {
		drained = true;
	});
	await Promise.resolve();
	expect(drained).toBe(false);
	release?.(reply);
	await closing;
	await work;
	expect(saveFlashcards).not.toHaveBeenCalled();
	expect(courseFlashcards.getSnapshot()).toMatchObject({
		cancelled: true,
		running: false,
		generated: 0,
	});
	expect(
		vi
			.mocked(invoke)
			.mock.calls.filter(([cmd]) => cmd === "flashcards_request"),
	).toHaveLength(1);
});

it("management invalidates an in-flight read-only preview even after its temporary block is released", async () => {
	let release: ((value: Preparation) => void) | undefined;
	vi.mocked(listByCourse).mockResolvedValue([
		{
			id: 2,
			title: "Lesson",
			course_id: 1,
			relative_path: "lesson.mp4",
			sort_order: 0,
			missing_at: null,
			created_at: "created",
		},
	]);
	vi.mocked(invoke).mockImplementation(async (command) => {
		if (command === "flashcards_prepare")
			return new Promise<Preparation>((resolve) => {
				release = resolve;
			});
	});
	const preview = courseFlashcards.prepare(
		1,
		"Course",
		new AbortController().signal,
		() => {},
	);
	const rejected = expect(preview).rejects.toThrow("changed");
	await vi.waitFor(() => expect(release).toBeTypeOf("function"));
	await withFlashcardsPaused(1, async () => {});
	release?.(structuredClone(preparation));
	await rejected;
	expect(saveFlashcards).not.toHaveBeenCalled();
	expect(
		vi
			.mocked(invoke)
			.mock.calls.filter(([cmd]) => cmd === "flashcards_request"),
	).toHaveLength(0);
});
afterEach(async () => {
	await cancelFlashcards();
	allowCourseFlashcards(1);
});
it("prepares without network requests or key access and only exposes lesson-bound native operations", async () => {
	const input = await prepareFlashcards(1, 2);
	expect(input.identity).toEqual(identity);
	expect(invoke).toHaveBeenCalledExactlyOnceWith("flashcards_prepare", {
		inspectCheckpoint: true,
		lesson: {
			courseId: 1,
			lessonId: 2,
			relativePath: "lesson.mp4",
			generated: null,
		},
	});
	expect(saveFlashcards).not.toHaveBeenCalled();
});
it("generates once, validates the source before saving, finalizes afterwards, and retains no key in UI state", async () => {
	await sessionKey("demo-session-key");
	expect(JSON.stringify(flashcardSnapshot())).not.toContain("demo-session-key");
	await startFlashcards({ identity, prepared: preparation }, false);
	expect(saveFlashcards).toHaveBeenCalledTimes(1);
	const commands = vi.mocked(invoke).mock.calls.map(([command]) => command);
	expect(commands).toEqual([
		"flashcards_key",
		"flashcards_begin",
		"flashcards_request",
		"flashcards_validate_job",
		"flashcards_finish",
	]);
	expect(invoke).toHaveBeenLastCalledWith("flashcards_finish", {
		jobId: "native-job",
		saved: true,
	});
	expect(flashcardSnapshot().job).toMatchObject({
		running: false,
		error: null,
		stage: "Saved 1 flashcards",
	});
});
it("does not publish malformed output, retry it, or replace existing cards", async () => {
	vi.mocked(invoke).mockImplementation(async (command) => {
		if (command === "flashcards_begin") return "native-job";
		if (command === "flashcards_request") return { ...reply, content: "{}" };
	});
	await expect(
		startFlashcards({ identity, prepared: preparation }, false),
	).rejects.toThrow("missing required");
	expect(saveFlashcards).not.toHaveBeenCalled();
	expect(
		vi
			.mocked(invoke)
			.mock.calls.filter(([command]) => command === "flashcards_request"),
	).toHaveLength(1);
	expect(invoke).toHaveBeenLastCalledWith("flashcards_finish", {
		jobId: "native-job",
		saved: false,
	});
});
it("blocks competing jobs and management cancels late responses before any SQL publication", async () => {
	let release!: (reply: Reply) => void;
	vi.mocked(invoke).mockImplementation(async (command) => {
		if (command === "flashcards_begin") return "native-job";
		if (command === "flashcards_request")
			return new Promise<Reply>((resolve) => {
				release = resolve;
			});
	});
	const work = startFlashcards({ identity, prepared: preparation }, false);
	const stopped = expect(work).rejects.toThrow("cancelled");
	await vi.waitFor(() => expect(release).toBeTypeOf("function"));
	await expect(
		startFlashcards({ identity, prepared: preparation }, false),
	).rejects.toThrow("Another");
	const paused = pauseCourseFlashcards(1);
	release(reply);
	await stopped;
	await paused;
	expect(saveFlashcards).not.toHaveBeenCalled();
	await expect(
		startFlashcards({ identity, prepared: preparation }, false),
	).rejects.toThrow("course operation");
	allowCourseFlashcards(1);
});
it("releases management's block after a failed operation and never swallows cancellation IPC failure", async () => {
	await expect(
		withFlashcardsPaused(1, async () => {
			throw new Error("DB failed");
		}),
	).rejects.toThrow("DB failed");
	await expect(prepareFlashcards(1, 2)).resolves.toBeDefined();
	vi.mocked(invoke).mockRejectedValue(new Error("native unavailable"));
	await expect(withFlashcardsPaused(1, async () => {})).rejects.toThrow(
		"native unavailable",
	);
	vi.mocked(invoke).mockResolvedValue(undefined);
});
