/// <reference types="node" />
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { remove } from "@tauri-apps/plugin-fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	deleteCourseFromLibrary,
	updateCourseCover,
} from "@/features/library/edit-cover/courseActions";
import { updateCover } from "@/lib/db/courses";

let sqlite: DatabaseSync;
const bindings = (values: SQLInputValue[]) =>
	Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]));
vi.mock("@/lib/db/db", () => ({
	getDb: async () => ({
		select: async (query: string, values: SQLInputValue[] = []) =>
			sqlite
				.prepare(query)
				.all(bindings(values))
				.map((row) => ({ ...row })),
		execute: async (query: string, values: SQLInputValue[] = []) => {
			const result = sqlite.prepare(query).run(bindings(values));
			return {
				rowsAffected: Number(result.changes),
				lastInsertId: Number(result.lastInsertRowid),
			};
		},
	}),
}));
vi.mock("@tauri-apps/api/path", () => ({
	appDataDir: async () => "/app/data",
	join: async (...parts: string[]) => parts.join("/"),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
	remove: vi.fn(),
	mkdir: vi.fn(),
	readFile: vi.fn(),
	stat: vi.fn(),
	writeFile: vi.fn(),
}));
const path = "/app/data/covers/1-12345678-1234-1234-1234-123456789abc.jpg";
beforeEach(() => {
	vi.clearAllMocks();
	sqlite = new DatabaseSync(":memory:");
	sqlite.exec("PRAGMA foreign_keys=ON");
	for (const file of ["0001_initial.sql", "0002_missing_lessons.sql"])
		sqlite.exec(
			readFileSync(new URL(`./migrations/${file}`, import.meta.url), "utf8"),
		);
	sqlite.exec(`INSERT INTO courses(id,title,root_path) VALUES (1,'One','/videos/one'),(2,'Two','/videos/two');
		INSERT INTO lessons(id,course_id,title,relative_path,sort_order) VALUES (1,1,'Lesson','one.mp4',0),(2,2,'Other','two.mp4',0);
		INSERT INTO progress(lesson_id,completed,last_position_seconds,last_watched_at) VALUES (1,1,42.5,CURRENT_TIMESTAMP),(2,0,12,CURRENT_TIMESTAMP);
		INSERT INTO notes(lesson_id,content) VALUES (1,'Keep me'),(2,'Other note');`);
	sqlite
		.prepare("UPDATE courses SET cover_path=$1 WHERE id=1")
		.run({ $1: path });
});
afterEach(() => sqlite.close());
function learningRows() {
	return ["lessons", "progress", "notes"].map((table) =>
		sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1`).all(),
	);
}
it("editing/removing a thumbnail never alters lessons, progress or notes", async () => {
	const before = learningRows();
	await updateCourseCover(1, path, null);
	expect(
		sqlite.prepare("SELECT cover_path FROM courses WHERE id=1").get()
			?.cover_path,
	).toBeNull();
	expect(learningRows()).toEqual(before);
	expect(remove).toHaveBeenCalledExactlyOnceWith(path);
});
it("deleting a course cascades only its own learning rows", async () => {
	await deleteCourseFromLibrary(1);
	expect(sqlite.prepare("SELECT id FROM courses").all()).toMatchObject([
		{ id: 2 },
	]);
	expect(sqlite.prepare("SELECT id FROM lessons").all()).toMatchObject([
		{ id: 2 },
	]);
	expect(sqlite.prepare("SELECT lesson_id FROM progress").all()).toMatchObject([
		{ lesson_id: 2 },
	]);
	expect(
		sqlite.prepare("SELECT lesson_id,content FROM notes").all(),
	).toMatchObject([{ lesson_id: 2, content: "Other note" }]);
	expect(remove).toHaveBeenCalledExactlyOnceWith(path);
});
it("refuses to save a cover to an unknown course", async () => {
	await expect(updateCover(999, path)).rejects.toThrow("Course not found");
});
