import { expect, it, vi } from "vitest";
import {
	discoverLibraryDurations,
	durationCourseIds,
	type LibraryDurationDependencies,
} from "@/features/library/durations";
import type { DurationLesson } from "@/lib/db/durations";

const lesson = (courseId: number, id: number): DurationLesson => ({
	id,
	course_id: courseId,
	relative_path: `${id}.mp4`,
	duration_seconds: null,
});
it("only queues uncached courses in the current grid whose roots are registered", () => {
	const grid = [
		{ id: 1, duration_seconds: 120 },
		{ id: 2, duration_seconds: null },
		{ id: 3, duration_seconds: null },
		{ id: 4, duration_seconds: null },
		{ id: 5, duration_seconds: null },
	];
	expect(
		durationCourseIds(
			grid,
			new Map([
				[1, { courseId: 1, status: "registered", message: "" }],
				[2, { courseId: 2, status: "registered", message: "" }],
				[3, { courseId: 3, status: "missing", message: "" }],
				[4, { courseId: 4, status: "unauthorized", message: "" }],
				[9, { courseId: 9, status: "registered", message: "" }],
			]),
		),
	).toEqual([2]);
});
function fixture() {
	let revision = 0;
	const abort = new AbortController();
	const deps: LibraryDurationDependencies = {
		revision: () => revision,
		lessons: vi.fn(async (id) => [
			lesson(id, id * 10),
			lesson(id, id * 10 + 1),
		]),
		read: vi.fn(async () => 60),
		save: vi.fn(async () => true),
		total: vi.fn(async () => 120),
		changed: vi.fn(),
	};
	return {
		deps,
		abort,
		invalidate: () => {
			revision++;
		},
		run: (ids = [1, 2]) => discoverLibraryDurations(ids, abort.signal, deps),
	};
}
it("bounds the entire grid to two metadata reads, one course at a time", async () => {
	const f = fixture();
	let active = 0,
		peak = 0;
	const order: number[] = [];
	vi.mocked(f.deps.read).mockImplementation(async (row) => {
		active++;
		peak = Math.max(peak, active);
		order.push(row.course_id);
		await Promise.resolve();
		active--;
		return 60;
	});
	await f.run();
	expect(peak).toBe(2);
	expect(order).toEqual([1, 1, 2, 2]);
	expect(f.deps.save).toHaveBeenCalledTimes(4);
	expect(f.deps.changed).toHaveBeenCalledWith(1, 120);
	expect(f.deps.changed).toHaveBeenCalledWith(2, 120);
});
it("uses cached lessons without opening media and does not retry failures in a loop", async () => {
	const f = fixture();
	vi.mocked(f.deps.lessons).mockResolvedValue([]);
	await f.run([1]);
	expect(f.deps.read).not.toHaveBeenCalled();
	expect(f.deps.changed).toHaveBeenCalledWith(1, 120);
	vi.mocked(f.deps.lessons).mockResolvedValue([lesson(2, 20)]);
	vi.mocked(f.deps.read).mockRejectedValue(new Error("drive missing"));
	vi.mocked(f.deps.total).mockResolvedValue(null);
	await f.run([2]);
	expect(f.deps.read).toHaveBeenCalledTimes(1);
	expect(f.deps.save).not.toHaveBeenCalled();
	expect(f.deps.changed).toHaveBeenCalledWith(2, null);
});
it("cancels metadata and discards results when the library is hidden or left", async () => {
	const f = fixture();
	vi.mocked(f.deps.read).mockImplementation(async (_row, signal) => {
		f.abort.abort();
		expect(signal.aborted).toBe(true);
		return 60;
	});
	await f.run();
	expect(f.deps.save).not.toHaveBeenCalled();
	expect(f.deps.changed).not.toHaveBeenCalled();
	expect(f.deps.lessons).toHaveBeenCalledTimes(1);
});
it("ignores stale in-flight reads after a rescan or relocation", async () => {
	const f = fixture();
	vi.mocked(f.deps.read).mockImplementation(async () => {
		f.invalidate();
		return 60;
	});
	await f.run([1]);
	expect(f.deps.save).not.toHaveBeenCalled();
	expect(f.deps.changed).not.toHaveBeenCalled();
});
it("checks revision again after a total query before updating a card", async () => {
	const f = fixture();
	vi.mocked(f.deps.total).mockImplementation(async () => {
		f.invalidate();
		return 120;
	});
	await f.run([1]);
	expect(f.deps.changed).not.toHaveBeenCalled();
});
it("continues to another visible course after query/write failures", async () => {
	const f = fixture();
	vi.mocked(f.deps.lessons).mockRejectedValueOnce(new Error("unavailable"));
	vi.mocked(f.deps.save).mockRejectedValueOnce(new Error("locked"));
	await f.run();
	expect(f.deps.changed).toHaveBeenCalledWith(2, 120);
});
it("does no work after cancellation and never accesses courses not supplied by the grid", async () => {
	const f = fixture();
	f.abort.abort();
	await f.run();
	expect(f.deps.lessons).not.toHaveBeenCalled();
	const other = fixture();
	await other.run([9]);
	expect(other.deps.lessons).toHaveBeenCalledOnce();
	expect(other.deps.lessons).toHaveBeenCalledWith(9);
});
