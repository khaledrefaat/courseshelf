/// <reference types="node" />
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { backupDatabase } from "@/lib/db/backup";

let db: DatabaseSync;
let directory: string;
const execute = vi.fn(async (sql: string, values: SQLInputValue[]) =>
	db
		.prepare(sql)
		.run(Object.fromEntries(values.map((v, i) => [`$${i + 1}`, v]))),
);
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/lib/db/courses", () => ({
	list: async () => [{ root_path: "/course" }],
}));
vi.mock("@/lib/db/db", () => ({ getDb: async () => ({ execute }) }));
beforeEach(() => {
	vi.clearAllMocks();
	const base = resolve("node_modules/.cache/courseshelf-backup-tests");
	mkdirSync(base, { recursive: true });
	directory = mkdtempSync(join(base, "export-"));
	db = new DatabaseSync(join(directory, "live.db"));
	db.exec("PRAGMA journal_mode=WAL;");
	for (const file of [
		"0001_initial.sql",
		"0002_missing_lessons.sql",
		"0003_lesson_durations.sql",
	])
		db.exec(
			readFileSync(new URL(`./migrations/${file}`, import.meta.url), "utf8"),
		);
	db.exec(
		"INSERT INTO courses(id,title,root_path) VALUES(1,'One','/course'); INSERT INTO lessons(id,course_id,relative_path,title,sort_order) VALUES(1,1,'one.mp4','One',0); INSERT INTO progress(lesson_id,completed,last_position_seconds) VALUES(1,1,42); INSERT INTO notes(lesson_id,content) VALUES(1,'مرحبا SQL');",
	);
	vi.mocked(invoke).mockImplementation(async (_command, args) => {
		const options = args as { path: string; verify: boolean };
		if (!options.path.startsWith(directory)) throw new Error("bad path");
		if (!options.verify && existsSync(options.path))
			throw new Error("already exists");
		if (
			options.verify &&
			(!existsSync(options.path) || readFileSync(options.path).length === 0)
		)
			throw new Error("empty backup");
		return options.path;
	});
});
afterEach(() => {
	db.close();
	rmSync(directory, { recursive: true });
});
it("exports a consistent WAL database through a bound VACUUM target, then verifies output and row counts", async () => {
	const target = join(directory, "backup.db");
	expect(await backupDatabase(target)).toBe(target);
	expect(execute).toHaveBeenCalledWith("VACUUM INTO $1", [target]);
	expect(invoke).toHaveBeenNthCalledWith(1, "validate_backup_target", {
		path: target,
		courseRoots: ["/course"],
		verify: false,
	});
	expect(invoke).toHaveBeenNthCalledWith(2, "validate_backup_target", {
		path: target,
		courseRoots: ["/course"],
		verify: true,
	});
	const output = new DatabaseSync(target);
	try {
		expect(output.prepare("PRAGMA integrity_check").get()).toMatchObject({
			integrity_check: "ok",
		});
		for (const table of ["courses", "lessons", "progress", "notes"])
			expect(
				output.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get(),
			).toEqual(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get());
		expect(output.prepare("SELECT content FROM notes").get()).toMatchObject({
			content: "مرحبا SQL",
		});
	} finally {
		output.close();
	}
});
it("never executes VACUUM when a target already exists and preserves its bytes", async () => {
	const target = join(directory, "live.db");
	const before = readFileSync(target);
	await expect(backupDatabase(target)).rejects.toThrow("already exists");
	expect(execute).not.toHaveBeenCalled();
	expect(readFileSync(target)).toEqual(before);
});
it("reports verification failure instead of claiming backup success", async () => {
	vi.mocked(invoke)
		.mockResolvedValueOnce(join(directory, "backup.db"))
		.mockRejectedValueOnce(new Error("missing output"));
	await expect(backupDatabase(join(directory, "backup.db"))).rejects.toThrow(
		"missing output",
	);
});
