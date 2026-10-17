/// <reference types="node" />
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { addCourse } from "@/features/library/add-course/addCourse";
import { findDuplicate } from "@/features/library/add-course/folders";
import { listCourseSummaries } from "@/lib/db/courseSummaries";
import { registerCourseRoot } from "@/lib/playback";
import { scanCourse } from "@/lib/scanner/scanCourse";
import { buildCourseStructure } from "@/lib/scanner/structure";

let sqlite: DatabaseSync;
const bindings = (values: SQLInputValue[]) =>
	Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]));
vi.mock("@/lib/db/db", () => ({
	getDb: async () => ({
		execute: async (query: string, values: SQLInputValue[] = []) => {
			const result = sqlite.prepare(query).run(bindings(values));
			return {
				lastInsertId: Number(result.lastInsertRowid),
				rowsAffected: Number(result.changes),
			};
		},
		select: async (query: string, values: SQLInputValue[] = []) =>
			sqlite
				.prepare(query)
				.all(bindings(values))
				.map((row) => ({ ...row })),
	}),
}));
vi.mock("@/features/library/add-course/folders", async (original) => ({
	...(await original<typeof import("@/features/library/add-course/folders")>()),
	findDuplicate: vi.fn(),
}));
vi.mock("@/lib/playback", () => ({ registerCourseRoot: vi.fn() }));
vi.mock("@/lib/scanner/scanCourse", () => ({ scanCourse: vi.fn() }));
beforeEach(() => {
	vi.resetAllMocks();
	sqlite = new DatabaseSync(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON");
	for (const file of ["0001_initial.sql", "0002_missing_lessons.sql"])
		sqlite.exec(
			readFileSync(new URL(`./migrations/${file}`, import.meta.url), "utf8"),
		);
	vi.mocked(findDuplicate).mockResolvedValue(false);
	vi.mocked(scanCourse).mockResolvedValue({
		root_path: "/canonical",
		skipped_symlink_count: 0,
		...buildCourseStructure(["one.mp4", "two.webm"]),
	});
	vi.mocked(registerCourseRoot).mockResolvedValue({
		courseId: 1,
		status: "registered",
		message: "Registered",
	});
});
afterEach(() => sqlite.close());
it("adds the canonical course and lessons, immediately visible as New in Library", async () => {
	await addCourse({ root: "/picked", title: "  My SQL  ", cover: null });
	expect(await listCourseSummaries()).toMatchObject([
		{
			title: "My SQL",
			total_lessons: 2,
			completed_lessons: 0,
			last_watched_at: null,
		},
	]);
	expect(sqlite.prepare("SELECT root_path FROM courses").get()?.root_path).toBe(
		"/canonical",
	);
});
it("rolls back the new course and cascades its rows on registration failure", async () => {
	vi.mocked(registerCourseRoot).mockImplementation(async () => {
		sqlite.exec(
			"INSERT INTO progress (lesson_id) SELECT id FROM lessons; INSERT INTO notes (lesson_id, content) SELECT id, 'test' FROM lessons",
		);
		return { courseId: 1, status: "unauthorized", message: "Not authorized" };
	});
	await expect(
		addCourse({ root: "/picked", title: "Test", cover: null }),
	).rejects.toThrow("Not authorized");
	for (const table of ["courses", "lessons", "progress", "notes"])
		expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n).toBe(
			0,
		);
});
