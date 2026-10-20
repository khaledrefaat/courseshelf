/// <reference types="node" />
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { MAX_EXTRA_CONTEXT_CHARACTERS } from "@/lib/flashcards/core";

let db: DatabaseSync;
const migration = readFileSync(
	new URL("./migrations/0007_flashcard_context.sql", import.meta.url),
	"utf8",
);
const payload = (context: string | null) =>
	JSON.stringify([
		{
			question: "What is a base case?",
			answer: "A condition that stops further recursive calls.",
			extraContext: context,
			evidence: [
				{
					cueId: 1,
					quote: "A base case terminates recursion.",
					start: 0,
					end: 5,
				},
			],
		},
	]);
function state() {
	return Object.fromEntries(
		[
			"courses",
			"lessons",
			"progress",
			"notes",
			"generated_subtitles",
			"flashcard_sets",
			"flashcards",
		].map((table) => [
			table,
			db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
		]),
	);
}
function migrate() {
	db.exec("BEGIN");
	try {
		db.exec(migration);
		db.exec("COMMIT");
	} catch (cause) {
		db.exec("ROLLBACK");
		throw cause;
	}
}
beforeEach(() => {
	db = new DatabaseSync(":memory:");
	db.exec("PRAGMA foreign_keys=ON");
	for (const file of [
		"0001_initial.sql",
		"0002_missing_lessons.sql",
		"0003_lesson_durations.sql",
		"0004_course_archived.sql",
		"0005_generated_subtitles.sql",
		"0006_flashcards.sql",
	])
		db.exec(
			readFileSync(new URL(`./migrations/${file}`, import.meta.url), "utf8"),
		);
	db.exec(
		"INSERT INTO courses(id,title,root_path) VALUES(1,'Course','/course'); INSERT INTO lessons(id,course_id,title,relative_path,sort_order) VALUES(2,1,'Edited','2.mp4',0),(3,1,'Empty','3.mp4',1); INSERT INTO progress(lesson_id,completed,last_position_seconds) VALUES(2,1,42); INSERT INTO notes(lesson_id,content) VALUES(2,'My note');",
	);
	const insert = db.prepare(
		"INSERT INTO flashcard_sets(id,lesson_id,generation_id,source_hash,source_fingerprint,source_name,model,prompt_version,validator_version,notes,usage_json,card_payload,created_at,updated_at) VALUES($id,$lesson,'old-job','hash','fingerprint','lesson.vtt','glm-5.3-flash','flashcards-trial-7','flashcards-validator-6','Keep this','{\"newRequests\":[],\"reusedRequests\":[]}',$cards,'2026-01-01','2026-01-02')",
	);
	insert.run({ $id: 10, $lesson: 2, $cards: payload("My edited explanation") });
	insert.run({ $id: 20, $lesson: 3, $cards: "[]" });
	db.exec(
		"UPDATE flashcards SET id=123,edited=1,question='My edited question?' WHERE set_id=10",
	);
});
afterEach(() => db.close());
it("upgrades an existing v6 database without changing IDs, edits, empty sets, evidence, usage or unrelated data", () => {
	const before = state();
	expect(() =>
		db
			.prepare("UPDATE flashcards SET extra_context=$context")
			.run({ $context: "x".repeat(501) }),
	).toThrow();
	migrate();
	expect(state()).toEqual(before);
	expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
	expect(db.prepare("PRAGMA integrity_check").get()).toMatchObject({
		integrity_check: "ok",
	});
	expect(db.prepare("PRAGMA foreign_keys").get()).toMatchObject({
		foreign_keys: 1,
	});
	expect(
		db
			.prepare(
				"SELECT name FROM sqlite_master WHERE name='flashcards_expanded'",
			)
			.all(),
	).toEqual([]);
	db.prepare("UPDATE flashcards SET extra_context=$context WHERE id=123").run({
		$context: "x".repeat(MAX_EXTRA_CONTEXT_CHARACTERS),
	});
	expect(() =>
		db
			.prepare("UPDATE flashcards SET extra_context=$context WHERE id=123")
			.run({ $context: "x".repeat(MAX_EXTRA_CONTEXT_CHARACTERS + 1) }),
	).toThrow();
});
it("preserves atomic publication/replacement, bounds and cascades with foreign keys enabled", () => {
	migrate();
	const context = "Useful explanation. ".repeat(50);
	db.prepare("UPDATE flashcard_sets SET card_payload=$cards WHERE id=20").run({
		$cards: payload(context),
	});
	expect(
		db.prepare("SELECT extra_context FROM flashcards WHERE set_id=20").get(),
	).toMatchObject({ extra_context: context });
	const before = state();
	expect(() =>
		db
			.prepare("UPDATE flashcard_sets SET card_payload=$cards WHERE id=10")
			.run({ $cards: payload("x".repeat(1201)) }),
	).toThrow();
	expect(state()).toEqual(before); // DELETE + failing INSERT rolled back together
	expect(() =>
		db.exec(
			"INSERT INTO flashcards(set_id,sort_order,question,answer,evidence_json) VALUES(999,0,'Q','A','[]')",
		),
	).toThrow();
	db.exec("DELETE FROM courses WHERE id=1");
	expect(db.prepare("SELECT * FROM flashcards").all()).toEqual([]);
	expect(db.prepare("SELECT * FROM flashcard_sets").all()).toEqual([]);
	expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
});
it("rolls back the table rebuild and original triggers if a migration transaction fails", () => {
	const before = state();
	db.exec("BEGIN");
	try {
		db.exec(migration);
		db.exec("SELECT * FROM deliberately_missing_fixture_table");
	} catch {
		db.exec("ROLLBACK");
	}
	expect(state()).toEqual(before);
	db.prepare("UPDATE flashcard_sets SET card_payload=$cards WHERE id=20").run({
		$cards: payload(null),
	});
	expect(
		db.prepare("SELECT * FROM flashcards WHERE set_id=20").all(),
	).toHaveLength(1);
	expect(() =>
		db
			.prepare("UPDATE flashcards SET extra_context=$context")
			.run({ $context: "x".repeat(501) }),
	).toThrow();
	expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
});
