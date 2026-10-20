/// <reference types="node" />
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	deleteFlashcard,
	editFlashcard,
	type FlashcardLesson,
	flashcardLesson,
	flashcardStamp,
	readFlashcards,
	saveFlashcards,
} from "@/lib/db/flashcards";
import {
	allowLessonWrites,
	discardLessonWrites,
	waitForProgressWrites,
} from "@/lib/db/progressWrites";
import type { GenerationResult, Source } from "@/lib/flashcards/pipeline";

let db: DatabaseSync;
const bind = (values: SQLInputValue[]) =>
	Object.fromEntries(values.map((value, i) => [`$${i + 1}`, value]));
const execute = vi.fn(async (sql: string, values: SQLInputValue[] = []) => {
	const result = db.prepare(sql).run(bind(values));
	return { rowsAffected: Number(result.changes) };
});
vi.mock("@/lib/db/db", () => ({
	getDb: async () => ({
		execute,
		select: async (sql: string, values: SQLInputValue[]) =>
			db.prepare(sql).all(bind(values)),
	}),
}));
const source: Source = {
	content: "",
	filename: "lesson.vtt",
	sourceHash: "a".repeat(64),
	sourceFingerprint: "b".repeat(64),
};
const result: GenerationResult = {
	cards: [
		{
			question: "Question?",
			answer: "Answer",
			extraContext: "Small example.",
			evidence: [{ cueId: 1, quote: "Transcript quote.", start: 0, end: 10 }],
		},
	],
	notes: ["Review quality."],
	usage: {
		newRequests: [{ promptTokens: 10, completionTokens: 5, totalTokens: 15 }],
		reusedRequests: [],
	},
};
let identity: FlashcardLesson;
beforeEach(async () => {
	db = new DatabaseSync(":memory:");
	db.exec("PRAGMA foreign_keys=ON");
	for (const file of [
		"0001_initial.sql",
		"0002_missing_lessons.sql",
		"0003_lesson_durations.sql",
		"0004_course_archived.sql",
		"0005_generated_subtitles.sql",
		"0006_flashcards.sql",
		"0007_flashcard_context.sql",
	])
		db.exec(
			readFileSync(new URL(`./migrations/${file}`, import.meta.url), "utf8"),
		);
	db.exec(
		"INSERT INTO courses(id,title,root_path) VALUES(1,'Course','/course'); INSERT INTO lessons(id,course_id,relative_path,title,sort_order) VALUES(2,1,'lesson.mp4','Lesson',0); INSERT INTO progress(lesson_id,completed,last_position_seconds) VALUES(2,1,42); INSERT INTO notes(lesson_id,content) VALUES(2,'Keep notes');",
	);
	allowLessonWrites([2]);
	execute.mockClear();
	identity = await flashcardLesson(1, 2);
});
afterEach(async () => {
	await waitForProgressWrites();
	db.close();
	allowLessonWrites([2]);
});
it("publishes a complete set in one statement, clears staging, and leaves progress/notes untouched", async () => {
	await saveFlashcards(identity, "job-1", source, result, () => {});
	expect(execute).toHaveBeenCalledTimes(1);
	const saved = await readFlashcards(2);
	expect(saved?.cards[0].evidence[0].quote).toBe("Transcript quote.");
	expect(saved?.usage.newRequests[0]?.totalTokens).toBe(15);
	expect(
		db.prepare("SELECT card_payload FROM flashcard_sets").get(),
	).toMatchObject({ card_payload: null });
	expect(
		db.prepare("SELECT completed,last_position_seconds FROM progress").get(),
	).toMatchObject({ completed: 1, last_position_seconds: 42 });
	expect(db.prepare("SELECT content FROM notes").get()).toMatchObject({
		content: "Keep notes",
	});
});
it("course publication is insert-only atomically, preserving edits, deletions and zero-card sets", async () => {
	expect(await flashcardStamp(2)).toBeNull();
	await saveFlashcards(identity, "batch", source, result, () => {}, true);
	const saved = await readFlashcards(2);
	if (!saved) throw new Error("fixture");
	await editFlashcard(
		saved,
		saved.cards[0].id,
		"My question?",
		"My answer",
		null,
	);
	const edited = await readFlashcards(2);
	await expect(
		saveFlashcards(identity, "race", source, result, () => {}, true),
	).rejects.toThrow("already has a saved set");
	expect(await readFlashcards(2)).toEqual(edited);
	await deleteFlashcard(saved, saved.cards[0].id);
	expect(await flashcardStamp(2)).toEqual({
		sourceHash: source.sourceHash,
		sourceFingerprint: source.sourceFingerprint,
	});
	await expect(
		saveFlashcards(identity, "race-empty", source, result, () => {}, true),
	).rejects.toThrow("already has a saved set");
	expect((await readFlashcards(2))?.cards).toEqual([]);
	expect((await readFlashcards(2))?.generationId).toBe("batch");
});
it("rolls back all replacement rows and metadata when one card violates a database constraint", async () => {
	await saveFlashcards(identity, "old", source, result, () => {});
	const before = await readFlashcards(2);
	await expect(
		saveFlashcards(
			identity,
			"new",
			{ ...source, sourceHash: "changed" },
			{
				...result,
				cards: [...result.cards, { ...result.cards[0], answer: "" }],
			},
			() => {},
		),
	).rejects.toThrow();
	expect(await readFlashcards(2)).toEqual(before);
});
it("accepts zero-card sets, serializes edits, and binds edits/deletions to the current generation", async () => {
	await saveFlashcards(identity, "old", source, result, () => {});
	const old = await readFlashcards(2);
	if (!old) throw new Error("fixture");
	await editFlashcard(
		old,
		old.cards[0].id,
		"Corrected?",
		"Corrected answer",
		null,
	);
	expect((await readFlashcards(2))?.cards[0]).toMatchObject({
		question: "Corrected?",
		edited: true,
		extraContext: null,
	});
	await saveFlashcards(identity, "new", source, result, () => {});
	await expect(
		editFlashcard(old, old.cards[0].id, "Stale?", "Wrong target", null),
	).rejects.toThrow("changed");
	await deleteFlashcard(old, old.cards[0].id);
	expect((await readFlashcards(2))?.cards).toHaveLength(1);
	await saveFlashcards(
		identity,
		"empty",
		source,
		{ ...result, cards: [] },
		() => {},
	);
	expect((await readFlashcards(2))?.cards).toEqual([]);
});
it("rejects stale roots, missing lessons and cancelled final saves without replacing the prior cards", async () => {
	await saveFlashcards(identity, "old", source, result, () => {});
	await expect(
		saveFlashcards(
			{ ...identity, rootPath: "/wrong" },
			"bad",
			source,
			result,
			() => {},
		),
	).rejects.toThrow("changed");
	db.exec("UPDATE lessons SET missing_at=CURRENT_TIMESTAMP WHERE id=2");
	await expect(
		saveFlashcards(identity, "missing", source, result, () => {}),
	).rejects.toThrow("changed");
	expect((await readFlashcards(2))?.generationId).toBe("old");
	await expect(
		saveFlashcards(identity, "cancel", source, result, () => {
			throw new Error("cancelled");
		}),
	).rejects.toThrow("cancelled");
});
it("course removal cascades both tables and blocked late saves cannot resurrect data", async () => {
	await saveFlashcards(identity, "old", source, result, () => {});
	await discardLessonWrites([2]);
	db.exec("DELETE FROM courses WHERE id=1");
	await expect(
		saveFlashcards(identity, "late", source, result, () => {}),
	).rejects.toThrow("discarded");
	expect(
		db.prepare("SELECT count(*) AS n FROM flashcards").get(),
	).toMatchObject({ n: 0 });
	expect(
		db.prepare("SELECT count(*) AS n FROM flashcard_sets").get(),
	).toMatchObject({ n: 0 });
	expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
});

it("VACUUM backups reopen with cards, edits, evidence and foreign keys intact", async () => {
	await saveFlashcards(identity, "saved", source, result, () => {});
	const saved = await readFlashcards(2);
	if (!saved) throw new Error("fixture");
	await editFlashcard(
		saved,
		saved.cards[0].id,
		"My question?",
		"My answer",
		"My added explanation. ".repeat(40),
	);
	const base = resolve("node_modules/.cache/flashcard-backup-tests");
	mkdirSync(base, { recursive: true });
	const directory = mkdtempSync(join(base, "backup-")),
		path = join(directory, "copy.db");
	try {
		db.prepare("VACUUM INTO $1").run({ $1: path });
		const copy = new DatabaseSync(path, { readOnly: true });
		try {
			expect(copy.prepare("PRAGMA integrity_check").get()).toMatchObject({
				integrity_check: "ok",
			});
			expect(copy.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
			for (const table of [
				"courses",
				"lessons",
				"notes",
				"progress",
				"flashcard_sets",
				"flashcards",
			])
				expect(
					copy.prepare(`SELECT count(*) AS n FROM ${table}`).get(),
				).toEqual(db.prepare(`SELECT count(*) AS n FROM ${table}`).get());
			expect(
				copy
					.prepare(
						"SELECT question,answer,extra_context,edited,evidence_json FROM flashcards",
					)
					.get(),
			).toMatchObject({
				question: "My question?",
				answer: "My answer",
				extra_context: "My added explanation. ".repeat(40).trim(),
				edited: 1,
				evidence_json: JSON.stringify(result.cards[0].evidence),
			});
			expect(
				copy
					.prepare(
						"SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%key%' OR name LIKE '%secret%')",
					)
					.all(),
			).toEqual([]);
		} finally {
			copy.close();
		}
	} finally {
		rmSync(directory, { recursive: true });
	}
});
