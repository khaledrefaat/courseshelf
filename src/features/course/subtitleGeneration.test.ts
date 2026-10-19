import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as generation from "@/features/course/subtitleGeneration";
import * as db from "@/lib/db/generatedSubtitles";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/lib/db/generatedSubtitles", () => ({
	getGeneratedSubtitle: vi.fn(),
	listGeneratedSubtitles: vi.fn(),
	removeGeneratedSubtitle: vi.fn(),
	saveGeneratedSubtitle: vi.fn(),
}));
const row = {
	lessonId: 1,
	filename: `1-${"a".repeat(64)}.en.vtt`,
	sourceFingerprint: "fingerprint",
	modelId: "base.en",
	modelSha256: "hash",
};
const vtt = "WEBVTT\n\n00:00.000 --> 00:02.000\nHello";
const status = {
	modelPresent: true,
	helpersPresent: true,
	job: null as generation.GenerationJob | null,
};
beforeEach(() => {
	vi.clearAllMocks();
	status.job = null;
	vi.mocked(db.getGeneratedSubtitle).mockResolvedValue(null);
	vi.mocked(db.listGeneratedSubtitles).mockResolvedValue([row]);
	vi.mocked(db.saveGeneratedSubtitle).mockResolvedValue();
	vi.mocked(invoke).mockImplementation(async (command, args) => {
		if (command === "subtitle_generation_status")
			return structuredClone(status);
		if (command === "start_subtitle_generation") return "job";
		if (command === "validate_generated_subtitle_job") return vtt;
		if (command === "finish_subtitle_generation") {
			status.job = null;
			return;
		}
		if (command === "read_generated_subtitle") return vtt;
		if (command === "get_lesson_subtitle") return null;
		if (command === "cancel_subtitle_generation" && status.job)
			status.job = {
				...status.job,
				running: false,
				error: "Cancelled.",
				result: null,
			};
		void args;
	});
	generation.allowSubtitleGeneration(1);
});
afterEach(async () => {
	generation.initializeSubtitleGeneration()();
	await generation.pollGeneration();
});

it("prefers an existing sidecar without touching generated cache", async () => {
	vi.mocked(invoke).mockResolvedValueOnce({
		filename: "one.en.vtt",
		content: vtt,
	});
	expect(await generation.loadLessonSubtitle(1, 1, "one.mp4")).toEqual({
		filename: "one.en.vtt",
		content: vtt,
	});
	expect(db.getGeneratedSubtitle).not.toHaveBeenCalled();
});
it("loads generated subtitles after restart and invalidates stale/missing cache", async () => {
	vi.mocked(db.getGeneratedSubtitle).mockResolvedValue(row);
	expect((await generation.loadLessonSubtitle(1, 1, "one.mp4"))?.content).toBe(
		vtt,
	);
	vi.mocked(invoke).mockImplementation(async () => null);
	expect(await generation.loadLessonSubtitle(1, 1, "one.mp4")).toBeNull();
	expect(db.removeGeneratedSubtitle).toHaveBeenCalledWith(1, row.filename);
	expect(invoke).toHaveBeenCalledWith("remove_generated_subtitle", {
		lessonId: 1,
		filename: row.filename,
	});
});
it("captures the original lesson and writes metadata before committing output", async () => {
	await generation.startGeneration(1, 1, "one.mp4", true);
	status.job = {
		id: "job",
		courseId: 1,
		lessonId: 1,
		stage: "Saving",
		progress: null,
		running: false,
		result: row,
		error: null,
	};
	await generation.pollGeneration();
	expect(db.saveGeneratedSubtitle).toHaveBeenCalledWith(1, "one.mp4", row);
	const saveOrder = vi.mocked(db.saveGeneratedSubtitle).mock
		.invocationCallOrder[0];
	const commitIndex = vi
		.mocked(invoke)
		.mock.calls.findIndex(
			([name, args]) =>
				name === "finish_subtitle_generation" &&
				(args as { keep: boolean }).keep,
		);
	expect(saveOrder).toBeLessThan(
		vi.mocked(invoke).mock.invocationCallOrder[commitIndex],
	);
});
it("rolls back metadata and staged output when SQLite save fails", async () => {
	await generation.startGeneration(1, 1, "one.mp4", false);
	vi.mocked(db.saveGeneratedSubtitle).mockRejectedValueOnce(
		new Error("disk full"),
	);
	status.job = {
		id: "job",
		courseId: 1,
		lessonId: 1,
		stage: "Saving",
		progress: null,
		running: false,
		result: row,
		error: null,
	};
	await generation.pollGeneration();
	expect(db.removeGeneratedSubtitle).toHaveBeenCalledWith(1, row.filename);
	expect(invoke).toHaveBeenCalledWith("finish_subtitle_generation", {
		jobId: "job",
		keep: false,
	});
});
it("restores previous metadata if committing the new subtitle file fails", async () => {
	const previous = { ...row, filename: `1-${"b".repeat(64)}.en.vtt` };
	vi.mocked(db.getGeneratedSubtitle).mockResolvedValue(previous);
	await generation.startGeneration(1, 1, "one.mp4", false);
	const native = vi.mocked(invoke).getMockImplementation();
	vi.mocked(invoke).mockImplementation(async (command, args, options) => {
		if (
			command === "finish_subtitle_generation" &&
			(args as { keep: boolean }).keep
		)
			throw new Error("Could not save generated subtitles.");
		return native?.(command, args, options);
	});
	status.job = {
		id: "job",
		courseId: 1,
		lessonId: 1,
		stage: "Saving",
		progress: null,
		running: false,
		result: row,
		error: null,
	};
	await generation.pollGeneration();
	expect(db.removeGeneratedSubtitle).toHaveBeenCalledWith(1, row.filename);
	expect(db.saveGeneratedSubtitle).toHaveBeenLastCalledWith(
		1,
		"one.mp4",
		previous,
	);
	expect(invoke).not.toHaveBeenCalledWith("remove_generated_subtitle", {
		lessonId: 1,
		filename: previous.filename,
	});
});
it("course removal cancels the job and discards late results, without blocking on failed note saves", async () => {
	await generation.startGeneration(1, 1, "one.mp4", false);
	await generation.prepareSubtitleRemoval(1);
	status.job = {
		id: "job",
		courseId: 1,
		lessonId: 1,
		stage: "Saving",
		progress: null,
		running: false,
		result: row,
		error: null,
	};
	await generation.pollGeneration();
	expect(db.saveGeneratedSubtitle).not.toHaveBeenCalled();
	expect(invoke).toHaveBeenCalledWith("finish_subtitle_generation", {
		jobId: "job",
		keep: false,
	});
});

it("reserves generation for the course queue and only the owner can release it", async () => {
	await generation.pollGeneration();
	const owner = generation.reserveGeneration();
	try {
		await expect(
			generation.startGeneration(1, 1, "one.mp4", false),
		).rejects.toThrow("course subtitle queue");
		generation.releaseGeneration(Symbol());
		expect(() => generation.reserveGeneration()).toThrow("Another");
		await expect(
			generation.startGeneration(1, 1, "one.mp4", false, owner),
		).resolves.toBe("job");
	} finally {
		generation.releaseGeneration(owner);
	}
});
it("queue waiters resolve only after validated metadata and native file commit", async () => {
	const id = await generation.startGeneration(1, 1, "one.mp4", false);
	const waiting = generation.waitForGeneration(id);
	status.job = {
		id,
		courseId: 1,
		lessonId: 1,
		stage: "Saving",
		progress: null,
		running: false,
		result: row,
		error: null,
	};
	await generation.pollGeneration();
	await expect(waiting).resolves.toEqual(row);
	await expect(generation.waitForGeneration(id)).resolves.toEqual(row);
});
it("native failures reject queue waiters instead of advancing as successful", async () => {
	const id = await generation.startGeneration(1, 1, "one.mp4", false);
	const waiting = expect(generation.waitForGeneration(id)).rejects.toThrow(
		"unsupported audio",
	);
	status.job = {
		id,
		courseId: 1,
		lessonId: 1,
		stage: "Failed",
		progress: null,
		running: false,
		result: null,
		error: "unsupported audio",
	};
	await generation.pollGeneration();
	await waiting;
});
it("cancellation during asynchronous native start cancels that late job too", async () => {
	let release!: (id: string) => void;
	const native = vi.mocked(invoke).getMockImplementation();
	vi.mocked(invoke).mockImplementation((command, args, options) =>
		command === "start_subtitle_generation"
			? new Promise((resolve) => {
					release = resolve;
				})
			: Promise.resolve(native?.(command, args, options)),
	);
	const starting = expect(
		generation.startGeneration(1, 1, "one.mp4", false),
	).rejects.toThrow("cancelled while starting");
	await vi.waitFor(() => expect(release).toBeTypeOf("function"));
	expect(() => generation.reserveGeneration()).toThrow("Another");
	await generation.cancelGeneration(1);
	release("late-job");
	await starting;
	expect(invoke).toHaveBeenCalledWith("cancel_subtitle_generation", {
		jobId: "late-job",
		courseId: 1,
	});
});
it("management cancellation waits for the course queue to drain its export", async () => {
	let release!: () => void;
	const listener = vi.fn(
		() =>
			new Promise<void>((resolve) => {
				release = resolve;
			}),
	);
	const stop = generation.registerGenerationCancellation(listener);
	try {
		const settled = vi.fn();
		const cancellation = generation.cancelGeneration(1).then(settled);
		await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(1));
		expect(settled).not.toHaveBeenCalled();
		release();
		await cancellation;
		expect(settled).toHaveBeenCalledOnce();
	} finally {
		stop();
	}
});
