/// <reference types="node" />
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listCourseSummaries } from "@/lib/db/courseSummaries";
import * as notes from "@/lib/db/notes";
import { waitForProgressWrites } from "@/lib/db/progressWrites";

let sqlite: DatabaseSync;
let pause: Promise<void> | null = null;
const bind = (values: SQLInputValue[]) =>
	Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]));
const select = vi.fn(async (sql: string, values: SQLInputValue[] = []) =>
	sqlite
		.prepare(sql)
		.all(bind(values))
		.map((row) => ({ ...row })),
);
const execute = vi.fn(async (sql: string, values: SQLInputValue[] = []) => {
	if (pause) await pause;
	return sqlite.prepare(sql).run(bind(values));
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
	])
		sqlite.exec(
			readFileSync(new URL(`./migrations/${file}`, import.meta.url), "utf8"),
		);
	sqlite.exec(`INSERT INTO courses(id,title,root_path) VALUES (1,'One','/one'),(2,'Other','/other');
		INSERT INTO lessons(id,course_id,title,relative_path,sort_order,missing_at) VALUES
		(1,1,'First','one.mp4',5,NULL),(2,1,'Second','section/two.mp4',2,NULL),(3,1,'Missing','missing.mp4',0,CURRENT_TIMESTAMP),(4,2,'Other','other.webm',0,NULL),(5,1,'Tie','tie.mp4',2,NULL);
		INSERT INTO notes(lesson_id,content,updated_at) VALUES (1,'First note','2000-01-01 00:00:00'),(2,'Second note','2000-01-01 00:00:00'),(3,'Hidden note','2000-01-01 00:00:00'),(4,'Other note','2000-01-01 00:00:00'),(5,'Tie note','2000-01-01 00:00:00');
		INSERT INTO progress(lesson_id,completed,last_position_seconds) VALUES (1,1,42);`);
});
afterEach(async () => {
	await waitForProgressWrites();
	sqlite.close();
});
it("lists only active course notes in sort_order/id order with one parameterized query", async () => {
	const rows = await notes.listByCourse(1);
	expect(rows.map((row) => row.lesson_id)).toEqual([2, 5, 1]);
	expect(rows[0]).toMatchObject({
		title: "Second",
		relative_path: "section/two.mp4",
		updated_at: "2000-01-01 00:00:00",
	});
	expect(select).toHaveBeenCalledOnce();
	expect(select.mock.calls[0][1]).toEqual([1]);
});
it("preserves exact plain text, uses SQL timestamps, and never changes progress", async () => {
	const text = "  ملاحظات SELECT 'quoted' <b>plain</b>\n\t ";
	await notes.save(1, text);
	expect(await notes.get(1)).toMatchObject({ content: text });
	expect((await notes.get(1))?.updated_at).not.toBe("2000-01-01 00:00:00");
	expect(execute.mock.calls[0][0]).toContain("CURRENT_TIMESTAMP");
	expect(execute.mock.calls[0][1]).toEqual([1, text]);
	expect(
		sqlite
			.prepare(
				"SELECT completed,last_position_seconds FROM progress WHERE lesson_id=1",
			)
			.get(),
	).toMatchObject({ completed: 1, last_position_seconds: 42 });
});
it("deletes whitespace-only rows, supports explicit delete, and excludes legacy Unicode whitespace from counts", async () => {
	await notes.save(1, " \t\n\u00a0\u2003");
	expect(await notes.get(1)).toBeNull();
	await notes.delete(2);
	expect(await notes.get(2)).toBeNull();
	sqlite.prepare("UPDATE notes SET content=? WHERE lesson_id=5").run("\u2003");
	expect(await notes.listByCourse(1)).toEqual([]);
});
it("serializes saves/deletes and makes Library reads wait for queued notes", async () => {
	let release!: () => void;
	pause = new Promise<void>((resolve) => {
		release = resolve;
	});
	const old = notes.save(1, "old");
	const newer = notes.save(1, "new");
	const library = listCourseSummaries();
	await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
	expect(select).not.toHaveBeenCalled();
	release();
	await Promise.all([old, newer, library]);
	expect((await notes.get(1))?.content).toBe("new");
	pause = null;
	const save = notes.save(1, "another");
	const remove = notes.delete(1);
	await Promise.all([save, remove]);
	expect(await notes.get(1)).toBeNull();
});
it("rejects over-limit writes without altering the stored note", async () => {
	await expect(notes.save(1, "x".repeat(50_001))).rejects.toThrow("50,000");
	expect((await notes.get(1))?.content).toBe("First note");
});
