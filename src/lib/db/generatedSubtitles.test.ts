/// <reference types="node" />
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	type GeneratedSubtitle,
	getGeneratedSubtitle,
	listGeneratedSubtitles,
	removeGeneratedSubtitle,
	saveGeneratedSubtitle,
} from "@/lib/db/generatedSubtitles";

let sqlite: DatabaseSync;
const bindings = (values: SQLInputValue[]) =>
	Object.fromEntries(values.map((value, i) => [`$${i + 1}`, value]));
vi.mock("@/lib/db/db", () => ({
	getDb: async () => ({
		select: async (query: string, values: SQLInputValue[] = []) =>
			sqlite
				.prepare(query)
				.all(bindings(values))
				.map((row) => ({ ...row })),
		execute: async (query: string, values: SQLInputValue[] = []) => {
			const result = sqlite.prepare(query).run(bindings(values));
			return { rowsAffected: Number(result.changes) };
		},
	}),
}));
const row: GeneratedSubtitle = {
	lessonId: 1,
	filename: `1-${"a".repeat(64)}.en.vtt`,
	sourceFingerprint: "source-hash",
	modelId: "base.en",
	modelSha256: "model-hash",
};
beforeEach(() => {
	sqlite = new DatabaseSync(":memory:");
	sqlite.exec("PRAGMA foreign_keys=ON");
	for (const file of [
		"0001_initial.sql",
		"0002_missing_lessons.sql",
		"0003_lesson_durations.sql",
		"0004_course_archived.sql",
		"0005_generated_subtitles.sql",
	])
		sqlite.exec(
			readFileSync(new URL(`./migrations/${file}`, import.meta.url), "utf8"),
		);
	sqlite.exec(`INSERT INTO courses(id,title,root_path) VALUES(1,'One','/one'),(2,'Two','/two');
		INSERT INTO lessons(id,course_id,relative_path,title,sort_order) VALUES(1,1,'one.mp4','First',0),(2,1,'two.mp4','Second',1),(3,2,'three.mp4','Other',0);
		INSERT INTO progress(lesson_id,completed,last_position_seconds) VALUES(1,1,42);
		INSERT INTO notes(lesson_id,content) VALUES(1,'Keep me');`);
});
afterEach(() => sqlite.close());

it("upserts metadata with SQL timestamps without touching progress or notes", async () => {
	await saveGeneratedSubtitle(1, "one.mp4", row);
	await saveGeneratedSubtitle(1, "one.mp4", {
		...row,
		sourceFingerprint: "new-hash",
	});
	expect((await getGeneratedSubtitle(1))?.sourceFingerprint).toBe("new-hash");
	expect(
		sqlite
			.prepare("SELECT completed,last_position_seconds FROM progress")
			.get(),
	).toMatchObject({ completed: 1, last_position_seconds: 42 });
	expect(sqlite.prepare("SELECT content FROM notes").get()?.content).toBe(
		"Keep me",
	);
	expect(
		sqlite
			.prepare("SELECT created_at,updated_at FROM generated_subtitles")
			.get(),
	).toMatchObject({
		created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2} /),
		updated_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2} /),
	});
});
it("refuses wrong course/path, missing and removed lessons instead of late resurrection", async () => {
	await expect(saveGeneratedSubtitle(2, "one.mp4", row)).rejects.toThrow();
	await expect(saveGeneratedSubtitle(1, "wrong.mp4", row)).rejects.toThrow();
	sqlite.exec("UPDATE lessons SET missing_at=CURRENT_TIMESTAMP WHERE id=1");
	await expect(saveGeneratedSubtitle(1, "one.mp4", row)).rejects.toThrow();
	sqlite.exec("DELETE FROM courses WHERE id=1");
	await expect(saveGeneratedSubtitle(1, "one.mp4", row)).rejects.toThrow();
	expect(await getGeneratedSubtitle(1)).toBeNull();
});
it("keeps metadata through missing/restored lessons and relocation; deletion cascades", async () => {
	await saveGeneratedSubtitle(1, "one.mp4", row);
	sqlite.exec(
		"UPDATE lessons SET missing_at=CURRENT_TIMESTAMP WHERE id=1; UPDATE courses SET root_path='/new' WHERE id=1",
	);
	expect(await listGeneratedSubtitles(1)).toEqual([row]);
	sqlite.exec("UPDATE lessons SET missing_at=NULL WHERE id=1");
	expect(await getGeneratedSubtitle(1)).toEqual(row);
	await removeGeneratedSubtitle(1, "not-the-current-file");
	expect(await getGeneratedSubtitle(1)).toEqual(row);
	sqlite.exec("DELETE FROM courses WHERE id=1");
	expect(await listGeneratedSubtitles(1)).toEqual([]);
});
