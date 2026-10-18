/// <reference types="node" />
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { removeCourse } from "@/features/course-management/actions";
import { notesController } from "@/features/notes/store";
import { savePosition } from "@/lib/db/progress";
import {
	allowLessonWrites,
	waitForProgressWrites,
} from "@/lib/db/progressWrites";

let sqlite: DatabaseSync;
let progressGate: Promise<void> | undefined;
let failNotes = false;
let failProgress = false;
const bind = (v: SQLInputValue[]) =>
	Object.fromEntries(v.map((x, i) => [`$${i + 1}`, x]));
const execute = vi.fn(async (sql: string, values: SQLInputValue[] = []) => {
	if (failNotes && sql.includes("INSERT INTO notes"))
		throw new Error("disk full saving notes");
	if (progressGate && sql.includes("INSERT INTO progress")) await progressGate;
	if (failProgress && sql.includes("INSERT INTO progress"))
		throw new Error("disk full saving progress");
	return sqlite.prepare(sql).run(bind(values));
});
const select = vi.fn(async (sql: string, values: SQLInputValue[] = []) =>
	sqlite
		.prepare(sql)
		.all(bind(values))
		.map((r) => ({ ...r })),
);
vi.mock("@/lib/db/db", () => ({ getDb: async () => ({ execute, select }) }));
vi.mock("@/lib/playback", () => ({
	registerCourseRoot: vi.fn(),
	unregisterCourseRoot: vi.fn(),
}));
beforeEach(async () => {
	sqlite = new DatabaseSync(":memory:");
	progressGate = undefined;
	failNotes = false;
	failProgress = false;
	vi.clearAllMocks();
	allowLessonWrites([1, 2]);
	await notesController.discardCourse(1);
	await notesController.discardCourse(2);
	for (const file of [
		"0001_initial.sql",
		"0002_missing_lessons.sql",
		"0003_lesson_durations.sql",
	])
		sqlite.exec(
			readFileSync(new URL(`./migrations/${file}`, import.meta.url), "utf8"),
		);
	sqlite.exec(
		"INSERT INTO courses(id,title,root_path) VALUES(1,'Remove','/remove'),(2,'Keep','/keep'); INSERT INTO lessons(id,course_id,title,relative_path,sort_order) VALUES(1,1,'One','one.mp4',0),(2,2,'Two','two.mp4',0); INSERT INTO notes(lesson_id,content) VALUES(1,'Stored'),(2,'Keep me');",
	);
	await notesController.loadCourse(1, [
		{ id: 1, title: "One", relative_path: "one.mp4", sort_order: 0 },
	]);
});
afterEach(async () => {
	await waitForProgressWrites();
	sqlite.close();
	allowLessonWrites([1, 2]);
});
it("removal succeeds with failing notes, cancels queued writes, drains in-flight progress, and prevents late resurrection", async () => {
	failNotes = true;
	notesController.edit(1, "failing draft");
	await notesController.flush(1);
	expect(notesController.get(1)?.status).toBe("error");
	let release!: () => void;
	progressGate = new Promise<void>((r) => {
		release = r;
	});
	failProgress = true;
	const first = savePosition(1, 10).catch(() => {});
	await vi.waitFor(() =>
		expect(
			execute.mock.calls.some(([sql]) => sql.includes("INSERT INTO progress")),
		).toBe(true),
	);
	const queued = savePosition(1, 20);
	notesController.edit(1, "another unsaved draft");
	const queuedNote = notesController.flush(1);
	const removing = removeCourse(1);
	await vi.waitFor(() => expect(notesController.get(1)).toBeUndefined());
	expect(
		sqlite.prepare("SELECT id FROM courses WHERE id=1").get(),
	).toBeDefined();
	release();
	await Promise.all([first, queued, queuedNote, removing]);
	await notesController.flushCourse();
	await savePosition(1, 30);
	await waitForProgressWrites();
	expect(
		sqlite.prepare("SELECT id FROM courses WHERE id=1").get(),
	).toBeUndefined();
	expect(
		sqlite.prepare("SELECT * FROM notes WHERE lesson_id=1").get(),
	).toBeUndefined();
	expect(
		sqlite.prepare("SELECT * FROM progress WHERE lesson_id=1").get(),
	).toBeUndefined();
	expect(
		execute.mock.calls.filter(([sql]) => sql.includes("INSERT INTO progress")),
	).toHaveLength(1);
	expect(
		execute.mock.calls.filter(([sql]) => sql.includes("INSERT INTO notes")),
	).toHaveLength(1);
	expect(
		sqlite.prepare("SELECT content FROM notes WHERE lesson_id=2").get(),
	).toMatchObject({ content: "Keep me" });
});
