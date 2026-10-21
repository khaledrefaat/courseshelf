/// <reference types="node" />
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listCourseSummaries } from "@/lib/db/courseSummaries";

let sqlite: DatabaseSync;
const select = vi.fn(async (query: string) => sqlite.prepare(query).all());
vi.mock("@/lib/db/db", () => ({ getDb: async () => ({ select }) }));

beforeEach(() => {
	sqlite = new DatabaseSync(":memory:");
	for (const file of [
		"0001_initial.sql",
		"0002_missing_lessons.sql",
		"0003_lesson_durations.sql",
		"0004_course_archived.sql",
	])
		sqlite.exec(
			readFileSync(new URL(`./migrations/${file}`, import.meta.url), "utf8"),
		);
	sqlite.exec(`INSERT INTO courses (id, title, root_path) VALUES (1, 'Course', '/course'), (2, 'Empty', '/empty');
		INSERT INTO lessons (id, course_id, relative_path, title, sort_order) VALUES
		(1, 1, 'a.mp4', 'First', 0), (2, 1, 'b.mp4', 'Second', 1), (3, 1, 'c.mp4', 'Third', 2);
		INSERT INTO progress (lesson_id, completed, last_watched_at) VALUES (1, 0, '2026-10-16 10:00:00'), (2, 0, '2026-10-17 10:00:00');`);
	select.mockClear();
});
afterEach(() => sqlite.close());

describe("course summaries with actual SQLite", () => {
	it("sums cached durations in the existing Library query only when every active lesson is known", async () => {
		sqlite.exec("UPDATE lessons SET duration_seconds=60 WHERE id=1");
		expect((await listCourseSummaries())[0].duration_seconds).toBeNull();
		sqlite.exec(
			"UPDATE lessons SET duration_seconds=3600 WHERE id=2; UPDATE lessons SET duration_seconds=120 WHERE id=3",
		);
		select.mockClear();
		expect((await listCourseSummaries())[0].duration_seconds).toBe(3780);
		expect(select).toHaveBeenCalledTimes(1);
		// Cached values survive subsequent queries; nothing is recalculated from media.
		expect((await listCourseSummaries())[0].duration_seconds).toBe(3780);
		expect((await listCourseSummaries())[1].duration_seconds).toBeNull();
		sqlite.exec("UPDATE lessons SET missing_at=CURRENT_TIMESTAMP WHERE id=2");
		expect((await listCourseSummaries())[0].duration_seconds).toBe(180);
	});
	it.each([0, -1, Infinity])(
		"does not advertise a complete duration with an invalid %s cache entry",
		async (seconds) => {
			sqlite.exec("UPDATE lessons SET duration_seconds=60");
			sqlite
				.prepare("UPDATE lessons SET duration_seconds=? WHERE id=1")
				.run(seconds);
			expect((await listCourseSummaries())[0].duration_seconds).toBeNull();
		},
	);
	it("resumes the most recently watched incomplete lesson in one query", async () => {
		const rows = await listCourseSummaries();
		expect(rows[0]).toMatchObject({
			total_lessons: 3,
			completed_lessons: 0,
			last_watched_at: "2026-10-17 10:00:00",
			resume_lesson_id: 2,
			resume_lesson_title: "Second",
		});
		expect(rows[1]).toMatchObject({
			total_lessons: 0,
			completed_lessons: 0,
			last_watched_at: null,
			resume_lesson_id: null,
		});
		expect(select).toHaveBeenCalledTimes(1);
	});
	it("reports archived_at alongside each course", async () => {
		sqlite.exec(
			"UPDATE courses SET archived_at = CURRENT_TIMESTAMP WHERE id = 2",
		);
		const rows = await listCourseSummaries();
		expect(rows[0]).toMatchObject({ id: 1, archived_at: null });
		expect(rows[1].archived_at).not.toBeNull();
	});
	it("uses the next non-missing lesson after a completed watched lesson", async () => {
		sqlite.exec("UPDATE progress SET completed = 1 WHERE lesson_id = 2");
		expect((await listCourseSummaries())[0].resume_lesson_id).toBe(3);
	});
	it("the next lesson may already be completed, unless all are complete", async () => {
		sqlite.exec(
			"UPDATE progress SET completed = 1 WHERE lesson_id = 2; INSERT INTO progress (lesson_id, completed) VALUES (3, 1)",
		);
		expect((await listCourseSummaries())[0].resume_lesson_id).toBe(3);
	});
	it("falls back to the first incomplete when there is no next active lesson", async () => {
		sqlite.exec(
			"UPDATE progress SET completed = 1 WHERE lesson_id = 2; UPDATE lessons SET missing_at = CURRENT_TIMESTAMP WHERE id = 3",
		);
		expect((await listCourseSummaries())[0]).toMatchObject({
			total_lessons: 2,
			completed_lessons: 1,
			resume_lesson_id: 1,
		});
	});
	it("returns null when everything is completed", async () => {
		sqlite.exec(
			"UPDATE progress SET completed = 1; INSERT INTO progress (lesson_id, completed) VALUES (3, 1)",
		);
		expect((await listCourseSummaries())[0]).toMatchObject({
			total_lessons: 3,
			completed_lessons: 3,
			resume_lesson_id: null,
		});
	});
	it("without watches selects the first incomplete by sort order", async () => {
		sqlite.exec(
			"UPDATE progress SET last_watched_at = NULL; UPDATE progress SET completed = 1 WHERE lesson_id = 1",
		);
		expect((await listCourseSummaries())[0].resume_lesson_id).toBe(2);
	});
	it("excludes missing lessons from watch time, counts, and resume", async () => {
		sqlite.exec(
			"UPDATE lessons SET missing_at = CURRENT_TIMESTAMP WHERE id = 2",
		);
		expect((await listCourseSummaries())[0]).toMatchObject({
			total_lessons: 2,
			last_watched_at: "2026-10-16 10:00:00",
			resume_lesson_id: 1,
		});
	});
	it("breaks equal watch and sort-order ties deterministically", async () => {
		sqlite.exec(
			"UPDATE progress SET last_watched_at = '2026-10-17 10:00:00'; UPDATE lessons SET sort_order = 0",
		);
		expect((await listCourseSummaries())[0].resume_lesson_id).toBe(1);
	});
});
