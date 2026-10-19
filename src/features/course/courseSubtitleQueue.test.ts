import { expect, it, vi } from "vitest";
import {
	CourseSubtitleQueue,
	type QueueDependencies,
	type QueueLesson,
} from "@/features/course/courseSubtitleQueue";

const lessons = [1, 2, 3, 4].map((id) => ({
	id,
	title: `Lesson ${id}`,
	relative_path: `${id}.mp4`,
}));
function setup() {
	const owner = Symbol();
	const dependencies: QueueDependencies = {
		reserve: vi.fn(() => owner),
		release: vi.fn(),
		lessons: vi.fn(async () => lessons),
		sidecar: vi.fn(async () => false),
		cached: vi.fn(async () => false),
		generate: vi.fn(async () => {}),
		export: vi.fn(async () => "saved" as const),
	};
	return { dependencies, queue: new CourseSubtitleQueue(dependencies), owner };
}
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
it("runs sequentially in DB course order, skips sidecars and exports cached text without regenerating", async () => {
	const { dependencies: d, queue, owner } = setup();
	vi.mocked(d.sidecar).mockImplementation(async (_, lesson) => lesson.id === 1);
	vi.mocked(d.cached).mockImplementation(async (_, lesson) => lesson.id === 2);
	const order: number[] = [];
	let active = 0;
	vi.mocked(d.generate).mockImplementation(async (_, lesson) => {
		active++;
		expect(active).toBe(1);
		order.push(lesson.id);
		await Promise.resolve();
		active--;
	});
	await queue.start(10, "Course", true, true);
	expect(order).toEqual([3, 4]);
	expect(d.generate).toHaveBeenCalledWith(10, lessons[2], true, owner);
	expect(vi.mocked(d.export).mock.calls.map((call) => call[1].id)).toEqual([
		2, 3, 4,
	]);
	expect(queue.getSnapshot()).toMatchObject({
		running: false,
		total: 4,
		processed: 4,
		generated: 2,
		reused: 1,
		skipped: 1,
		exported: 3,
		failed: 0,
	});
	expect(d.release).toHaveBeenCalledWith(owner);
});
it("continues after generation and read-only export failures while retaining generated results", async () => {
	const { dependencies: d, queue } = setup();
	vi.mocked(d.generate).mockRejectedValueOnce(new Error("unsupported audio"));
	vi.mocked(d.export).mockRejectedValueOnce(new Error("read-only folder"));
	await queue.start(10, "Course", true, false);
	expect(queue.getSnapshot()).toMatchObject({
		processed: 4,
		generated: 3,
		failed: 1,
		exported: 2,
		exportFailed: 1,
		running: false,
	});
	expect(queue.getSnapshot()?.errors.join(" ")).toContain(
		"subtitles kept in Courseshelf",
	);
});
it("can keep everything in app data, and never exports existing sidecars", async () => {
	const { dependencies: d, queue } = setup();
	await queue.start(10, "Course", false, false);
	expect(d.export).not.toHaveBeenCalled();
	expect(queue.getSnapshot()?.generated).toBe(4);
});
it("cancellation while generating prevents exporting or starting any later lesson", async () => {
	const { dependencies: d, queue } = setup();
	const gate = deferred();
	vi.mocked(d.generate).mockReturnValueOnce(gate.promise);
	const done = queue.start(10, "Course", true, false);
	await vi.waitFor(() => expect(d.generate).toHaveBeenCalledOnce());
	expect(queue.cancel(99)).toBeUndefined();
	const cancelled = queue.cancel(10);
	gate.resolve();
	await cancelled;
	await done;
	expect(d.export).not.toHaveBeenCalled();
	expect(d.generate).toHaveBeenCalledOnce();
	expect(queue.getSnapshot()).toMatchObject({
		running: false,
		cancelled: true,
	});
});
it("cancellation drains an in-flight export before management can change or remove its root", async () => {
	const { dependencies: d, queue } = setup();
	const gate = deferred();
	vi.mocked(d.export).mockImplementationOnce(async () => {
		await gate.promise;
		return "saved";
	});
	const done = queue.start(10, "Course", true, false);
	await vi.waitFor(() => expect(d.export).toHaveBeenCalledOnce());
	const settled = vi.fn();
	const cancelled = queue.cancel(10)?.then(settled);
	await Promise.resolve();
	expect(settled).not.toHaveBeenCalled();
	gate.resolve();
	await cancelled;
	await done;
	expect(d.generate).toHaveBeenCalledOnce();
	expect(d.release).toHaveBeenCalledOnce();
});
it("holds one reservation, survives view subscriptions changing, and reruns only missing work", async () => {
	const { dependencies: d, queue } = setup();
	const gate = deferred();
	vi.mocked(d.generate).mockReturnValueOnce(gate.promise);
	const done = queue.start(10, "Course", true, false);
	const stop = queue.subscribe(vi.fn());
	stop();
	queue.dismiss();
	await expect(queue.start(11, "Other", true, false)).rejects.toThrow(
		"Another",
	);
	gate.resolve();
	await done;
	vi.mocked(d.sidecar).mockResolvedValue(true);
	vi.mocked(d.generate).mockClear();
	await queue.start(10, "Course", true, false);
	expect(d.generate).not.toHaveBeenCalled();
	expect(queue.getSnapshot()?.skipped).toBe(4);
	queue.dismiss();
	expect(queue.getSnapshot()).toBeNull();
});
it("a failed folder check releases the reservation without generating or exporting", async () => {
	const { dependencies: d, queue } = setup();
	vi.mocked(d.lessons).mockRejectedValue(new Error("FOLDER_NOT_AUTHORIZED"));
	await queue.start(10, "Course", true, false);
	expect(d.generate).not.toHaveBeenCalled();
	expect(d.export).not.toHaveBeenCalled();
	expect(d.release).toHaveBeenCalledOnce();
	expect(queue.getSnapshot()?.errors).toEqual(["FOLDER_NOT_AUTHORIZED"]);
});
it("uses a fixed lesson snapshot rather than adding lessons while the queue is running", async () => {
	const { dependencies: d, queue } = setup();
	vi.mocked(d.lessons).mockResolvedValue(lessons.slice(0, 2) as QueueLesson[]);
	await queue.start(10, "Course", true, false);
	expect(d.lessons).toHaveBeenCalledOnce();
	expect(d.generate).toHaveBeenCalledTimes(2);
});
