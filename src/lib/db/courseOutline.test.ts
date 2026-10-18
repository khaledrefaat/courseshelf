/// <reference types="node" />
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getCourseOutline } from "@/lib/db/courseOutline";
import { listCourseSummaries } from "@/lib/db/courseSummaries";
import {
	durationRevision,
	invalidateDurations,
	saveDuration,
} from "@/lib/db/durations";
import {
	get,
	savePosition,
	setCompleted,
	touchLastWatched,
} from "@/lib/db/progress";
import { waitForProgressWrites } from "@/lib/db/progressWrites";

let sqlite: DatabaseSync;
let pause: Promise<void> | null = null;
const bindings = (values: SQLInputValue[]) =>
	Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]));
const select = vi.fn(async (query: string, values: SQLInputValue[] = []) =>
	sqlite
		.prepare(query)
		.all(bindings(values))
		.map((row) => ({ ...row })),
);
const execute = vi.fn(async (query: string, values: SQLInputValue[] = []) => {
	if (pause) await pause;
	const result = sqlite.prepare(query).run(bindings(values));
	return { ...result, rowsAffected: Number(result.changes) };
});
vi.mock("@/lib/db/db", () => ({ getDb: async () => ({ select, execute }) }));
beforeEach(() => {
	sqlite = new DatabaseSync(":memory:");
	pause = null;
	vi.clearAllMocks();
	for (const file of [
		"0001_initial.sql",
		"0002_missing_lessons.sql",
		"0003_lesson_durations.sql",
		"0004_course_archived.sql",
	])
		sqlite.exec(
			readFileSync(new URL(`./migrations/${file}`, import.meta.url), "utf8"),
		);
	sqlite.exec(`INSERT INTO courses (id,title,root_path) VALUES (1,'Course','/one'),(2,'Empty','/empty'),(3,'Foreign','/other');
		INSERT INTO lessons(id,course_id,relative_path,title,sort_order,missing_at) VALUES
		(1,1,'one.mp4','One',1,NULL),(2,1,'two.mp4','Two',0,NULL),(3,1,'gone.mp4','Gone',2,CURRENT_TIMESTAMP),(4,3,'foreign.mp4','Foreign',0,NULL);
		INSERT INTO progress(lesson_id,completed,last_position_seconds,last_watched_at) VALUES (1,1,42.5,'2000-01-01 00:00:00');`);
});
afterEach(async () => {
	await waitForProgressWrites();
	sqlite.close();
});
it("returns course and active lessons with completion, ordered in a single query", async () => {
	const result = await getCourseOutline(1);
	expect(select).toHaveBeenCalledTimes(1);
	expect(select.mock.calls[0][1]).toEqual([1]);
	expect(result?.course).toMatchObject({ id: 1, title: "Course" });
	expect(result?.lessons.map((row) => [row.id, row.completed])).toEqual([
		[2, false],
		[1, true],
	]);
});
it("serializes cache invalidation behind in-flight writes and rejects stale results", async () => {
	let release!: () => void;
	pause = new Promise<void>((resolve) => {
		release = resolve;
	});
	const old = saveDuration(1, 1, 90, durationRevision(1));
	await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
	const invalidate = invalidateDurations(1);
	release();
	await Promise.all([old, invalidate]);
	pause = null;
	expect(
		(await getCourseOutline(1))?.lessons.find((row) => row.id === 1)
			?.duration_seconds,
	).toBeNull();
});

it("distinguishes missing course from course with no active lessons", async () => {
	expect(await getCourseOutline(999)).toBeNull();
	expect((await getCourseOutline(2))?.lessons).toEqual([]);
	sqlite.exec(
		"UPDATE lessons SET missing_at=CURRENT_TIMESTAMP WHERE course_id=1",
	);
	expect((await getCourseOutline(1))?.lessons).toEqual([]);
});

it("persists duration cache without touching progress and invalidates stale metadata after rescan", async () => {
	const revision = durationRevision(1);
	expect(await saveDuration(1, 1, 760, revision)).toBe(true);
	expect(
		(await getCourseOutline(1))?.lessons.find((row) => row.id === 1)
			?.duration_seconds,
	).toBe(760);
	expect(await get(1)).toMatchObject({
		completed: true,
		last_position_seconds: 42.5,
	});
	await invalidateDurations(1);
	expect(await saveDuration(1, 1, 999, revision)).toBe(false);
	expect(
		(await getCourseOutline(1))?.lessons.find((row) => row.id === 1)
			?.duration_seconds,
	).toBeNull();
	expect(await saveDuration(1, 3, 100, durationRevision(1))).toBe(false);
	expect(await saveDuration(1, 999, 100, durationRevision(1))).toBe(false);
	expect(await saveDuration(1, 1, Infinity, durationRevision(1))).toBe(false);
});
it("touchLastWatched creates defaults and preserves existing completion/position", async () => {
	await touchLastWatched(1);
	expect(await get(1)).toMatchObject({
		completed: true,
		last_position_seconds: 42.5,
	});
	expect((await get(1))?.last_watched_at).not.toBe("2000-01-01 00:00:00");
	await touchLastWatched(2);
	expect(await get(2)).toMatchObject({
		completed: false,
		last_position_seconds: 0,
		last_watched_at: expect.any(String),
	});
	const watched = (await get(1))?.last_watched_at;
	await setCompleted(1, false);
	expect(await get(1)).toMatchObject({
		completed: false,
		last_position_seconds: 42.5,
		last_watched_at: watched,
	});
});
it("fresh Library summaries wait for in-flight writes before querying on return", async () => {
	let resolve!: () => void;
	pause = new Promise((done) => {
		resolve = done;
	});
	const write = setCompleted(2, true);
	const library = listCourseSummaries();
	await vi.waitFor(() => expect(execute).toHaveBeenCalled());
	expect(select).not.toHaveBeenCalled();
	resolve();
	await write;
	expect((await library).find((row) => row.id === 1)?.completed_lessons).toBe(
		2,
	);
	pause = null;
	await setCompleted(2, false);
	expect(
		(await listCourseSummaries()).find((row) => row.id === 1)
			?.completed_lessons,
	).toBe(1);
});
it("failed writes don't block Library reads or change persisted counts", async () => {
	execute.mockRejectedValueOnce(new Error("DB locked"));
	await expect(setCompleted(2, true)).rejects.toThrow("DB locked");
	expect(
		(await listCourseSummaries()).find((row) => row.id === 1)
			?.completed_lessons,
	).toBe(1);
});

it("queued position writes preserve completion, update SQL timestamps and finish before Library queries", async () => {
	let release!: () => void;
	pause = new Promise<void>((resolve) => {
		release = resolve;
	});
	const first = savePosition(1, 50);
	const newer = savePosition(1, 60);
	const library = listCourseSummaries();
	await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
	expect(select).not.toHaveBeenCalled();
	release();
	await Promise.all([first, newer, library]);
	expect(await get(1)).toMatchObject({
		completed: true,
		last_position_seconds: 60,
	});
	expect((await get(1))?.last_watched_at).not.toBe("2000-01-01 00:00:00");
	expect(
		execute.mock.calls.every(([query]) => query.includes("CURRENT_TIMESTAMP")),
	).toBe(true);
});
