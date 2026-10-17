import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	createNotesController,
	type StoredNote,
} from "@/features/notes/controller";
import {
	trackProgressWrite,
	waitForProgressWrites,
} from "@/lib/db/progressWrites";

const lessons = [
	{ id: 1, title: "One", relative_path: "one.mp4", sort_order: 1 },
	{ id: 2, title: "Two", relative_path: "section/two.mp4", sort_order: 0 },
];
const stored = (lesson_id: number, content: string): StoredNote => ({
	lesson_id,
	content,
	updated_at: "2026-01-01 12:00:00",
});
function fixture(rows: StoredNote[] = []) {
	const load = vi.fn(async (_courseId: number) => rows);
	const write = vi.fn(async (id: number, text: string) =>
		text.trim() ? stored(id, text) : null,
	);
	return {
		load,
		write,
		controller: createNotesController({
			load,
			write,
			track: trackProgressWrite,
		}),
	};
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("debounces for 800ms, targets the edited lesson, and flushes before lesson switches", async () => {
	const { controller: c, write } = fixture([stored(2, "untouched")]);
	await c.loadCourse(5, lessons);
	c.edit(1, "first draft");
	await vi.advanceTimersByTimeAsync(799);
	expect(write).not.toHaveBeenCalled();
	// Same cleanup path used by a keyed editor when switching lessons.
	const leaving = c.flush(1);
	expect(c.get(2)?.content).toBe("untouched");
	await leaving;
	await vi.advanceTimersByTimeAsync(1000);
	expect(write.mock.calls).toEqual([[1, "first draft"]]);
	expect(c.get(2)?.content).toBe("untouched");
});
it("serializes older/newer writes and does not clobber typing or report Saved for an older revision", async () => {
	const { controller: c, write } = fixture();
	await c.loadCourse(5, lessons);
	let release!: (note: StoredNote) => void;
	write.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	c.edit(1, "old");
	const first = c.flush(1);
	await Promise.resolve();
	c.edit(1, "new النص");
	const newer = c.flush(1);
	await Promise.resolve();
	expect(write).toHaveBeenCalledTimes(1);
	expect(c.get(1)?.content).toBe("new النص");
	release(stored(1, "old"));
	await first;
	expect(c.get(1)?.status).toBe("saving");
	expect(c.get(1)?.content).toBe("new النص");
	await newer;
	expect(write.mock.calls).toEqual([
		[1, "old"],
		[1, "new النص"],
	]);
	expect(c.get(1)?.status).toBe("saved");
});
it("keeps failed drafts/status/warnings across tab remounts and course reloads, and supports retry", async () => {
	const { controller: c, write } = fixture([stored(1, "DB value")]);
	await c.loadCourse(5, lessons);
	write.mockRejectedValueOnce(new Error("disk full"));
	c.edit(1, "  نص غير محفوظ\n");
	await c.flush(1);
	expect(c.get(1)?.status).toBe("error");
	expect(c.failures()).toHaveLength(1);
	const unsubscribe = c.subscribe(() => {});
	unsubscribe(); // Tab unmount/re-mount has no ownership of the draft.
	await c.loadCourse(5, lessons);
	expect(c.get(1)?.content).toBe("  نص غير محفوظ\n");
	expect(c.get(1)?.error).toContain("memory");
	expect(await c.flushCourse(5)).toBe(true);
	expect(c.get(1)?.status).toBe("saved");
	expect(c.failures()).toEqual([]);
});
it("Arabic and mixed English/Arabic IME composition stays exact and is not saved mid-composition", async () => {
	const { controller: c, write } = fixture();
	await c.loadCourse(5, lessons);
	c.composition(1, true);
	for (const text of ["م", "مر", "مرحبا", "مرحبا SELECT الاسم\n  "]) {
		c.edit(1, text);
		await vi.advanceTimersByTimeAsync(1000);
		expect(c.get(1)?.content).toBe(text);
	}
	expect(write).not.toHaveBeenCalled();
	c.composition(1, false);
	await vi.advanceTimersByTimeAsync(800);
	expect(write).toHaveBeenCalledWith(1, "مرحبا SELECT الاسم\n  ");
	expect(c.get(1)?.content).toBe("مرحبا SELECT الاسم\n  ");
});
it("counts drafts immediately, removes whitespace-only notes, preserves content, and orders/excludes missing entries", async () => {
	const { controller: c } = fixture();
	await c.loadCourse(5, lessons);
	c.edit(1, "  keep\n");
	c.edit(2, "ثانٍ");
	expect(c.entries(5).map((d) => d.lesson.id)).toEqual([2, 1]);
	c.edit(2, " \n\t");
	expect(c.entries(5)).toHaveLength(1);
	await c.flushCourse(5);
	expect(c.get(1)?.content).toBe("  keep\n");
	await c.loadCourse(5, [lessons[1]]);
	expect(c.entries(5)).toEqual([]);
});
it("tracks the whole queued chain so Library reads wait for pending note writes", async () => {
	const { controller: c, write } = fixture();
	await c.loadCourse(5, lessons);
	let release!: (note: StoredNote) => void;
	write.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	c.edit(1, "one");
	const first = c.flush(1);
	await Promise.resolve();
	c.edit(1, "two");
	const second = c.flush(1);
	const read = vi.fn();
	const waiting = waitForProgressWrites().then(read);
	await Promise.resolve();
	expect(read).not.toHaveBeenCalled();
	release(stored(1, "one"));
	await Promise.all([first, second, waiting]);
	expect(read).toHaveBeenCalledOnce();
	expect(c.get(1)?.status).toBe("saved");
});
it("keeps failed navigation text and returns false until Retry succeeds", async () => {
	const { controller: c, write } = fixture();
	await c.loadCourse(5, lessons);
	c.edit(1, "don't lose this");
	write.mockRejectedValueOnce(new Error("locked"));
	expect(await c.flushCourse(5)).toBe(false);
	expect(c.get(1)?.content).toBe("don't lose this");
	expect(await c.flushCourse(5)).toBe(true);
});
it("does not let a stale load response replace text edited and saved while the query was in flight", async () => {
	const { controller: c, load } = fixture();
	await c.loadCourse(5, lessons);
	let release!: (rows: StoredNote[]) => void;
	load.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	const reloading = c.loadCourse(5, lessons);
	c.edit(1, "fresh");
	await c.flush(1);
	release([stored(1, "stale")]);
	await reloading;
	expect(c.get(1)?.content).toBe("fresh");
});
it("truncates over-limit input and keeps the visible limit flag in the controller across unmounts", async () => {
	const { controller: c } = fixture();
	await c.loadCourse(5, lessons);
	c.edit(1, "ن".repeat(50_010));
	expect(c.get(1)?.content).toHaveLength(50_000);
	expect(c.get(1)?.limitReached).toBe(true);
	await c.flush(1);
	expect(c.get(1)?.limitReached).toBe(true);
});
