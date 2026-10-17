/// <reference types="node" />
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as courses from "@/lib/db/courses";
import * as lessons from "@/lib/db/lessons";
import * as notes from "@/lib/db/notes";
import * as progress from "@/lib/db/progress";
import { syncCourse } from "@/lib/db/syncCourse";
import { scanCourse } from "@/lib/scanner/scanCourse";
import { buildCourseStructure } from "@/lib/scanner/structure";

let sqlite: DatabaseSync;

function bindings(values: SQLInputValue[]) {
	return Object.fromEntries(
		values.map((value, index) => [`$${index + 1}`, value]),
	);
}

vi.mock("@/lib/db/db", () => ({
	getDb: async () => ({
		execute: async (query: string, values: SQLInputValue[] = []) => {
			const statement = sqlite.prepare(query);
			const result = values.length
				? statement.run(bindings(values))
				: statement.run();
			return {
				rowsAffected: Number(result.changes),
				lastInsertId: Number(result.lastInsertRowid),
			};
		},
		select: async (query: string, values: SQLInputValue[] = []) => {
			const statement = sqlite.prepare(query);
			const rows = values.length
				? statement.all(bindings(values))
				: statement.all();
			return rows.map((row) => ({ ...row }));
		},
	}),
}));

vi.mock("@/lib/scanner/scanCourse", () => ({ scanCourse: vi.fn() }));

function found(paths: string[]) {
	return {
		root_path: "/chosen/course",
		skipped_symlink_count: 2,
		...buildCourseStructure(paths),
	};
}

function snapshot() {
	return JSON.stringify(
		["courses", "lessons", "progress", "notes"].map((table) =>
			sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1`).all(),
		),
	);
}

beforeEach(() => {
	sqlite = new DatabaseSync(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON");
	for (const file of ["0001_initial.sql", "0002_missing_lessons.sql"]) {
		sqlite.exec(
			readFileSync(new URL(`./migrations/${file}`, import.meta.url), "utf8"),
		);
	}
	vi.mocked(scanCourse).mockReset();
});

afterEach(() => sqlite.close());

async function fixture() {
	const course = await courses.create({
		title: "Test course",
		root_path: "/chosen/course",
	});
	vi.mocked(scanCourse).mockResolvedValue(
		found(["01 - One.mp4", "02 - Two.mp4"]),
	);
	expect((await syncCourse(course.id)).ok).toBe(true);
	const [first, second] = await lessons.listByCourse(course.id);
	await progress.setCompleted(first.id, true);
	await progress.savePosition(first.id, 42.5);
	await notes.save(first.id, "Keep this note");
	return { course, first, second };
}

describe("syncCourse with actual SQLite queries", () => {
	it("marks missing, excludes it from counts, and restores the same ID/progress/note", async () => {
		const { course, first } = await fixture();
		const savedProgress = await progress.get(first.id);
		const savedNote = await notes.get(first.id);
		vi.mocked(scanCourse).mockResolvedValue(
			found(["02 - Two.mp4", "03 - New.webm", "notes.pdf"]),
		);
		const removed = await syncCourse(course.id);
		expect(removed).toMatchObject({
			ok: true,
			added_count: 1,
			missing_count: 1,
			summary: { total_count: 2, completed_count: 0 },
			scan: { ignored_count: 1, skipped_symlink_count: 2 },
		});
		expect(await lessons.listByCourse(course.id)).toHaveLength(2);
		const missing = (await lessons.listAllByCourse(course.id)).find(
			(lesson) => lesson.id === first.id,
		);
		expect(missing?.missing_at).toEqual(expect.any(String));
		expect(await progress.get(first.id)).toEqual(savedProgress);
		expect(await notes.get(first.id)).toEqual(savedNote);
		const missingAt = missing?.missing_at;
		await syncCourse(course.id);
		expect(
			(await lessons.listAllByCourse(course.id)).find(
				(lesson) => lesson.id === first.id,
			)?.missing_at,
		).toBe(missingAt);
		vi.mocked(scanCourse).mockResolvedValue(
			found(["01 - One.mp4", "02 - Two.mp4", "03 - New.webm"]),
		);
		expect(await syncCourse(course.id)).toMatchObject({
			ok: true,
			added_count: 0,
			missing_count: 0,
			summary: { total_count: 3, completed_count: 1 },
		});
		expect(
			(await lessons.listByCourse(course.id)).find(
				(lesson) => lesson.id === first.id,
			)?.missing_at,
		).toBeNull();
		expect(await progress.get(first.id)).toEqual(savedProgress);
		expect(await notes.get(first.id)).toEqual(savedNote);
	});

	it.each(["active", "already missing"])(
		"aborts without writes when zero videos and %s DB lessons exist",
		async (state) => {
			const { course, first, second } = await fixture();
			if (state === "already missing")
				await lessons.markMissing(course.id, [first.id, second.id]);
			const before = snapshot();
			vi.mocked(scanCourse).mockResolvedValue(found([]));
			expect(await syncCourse(course.id)).toMatchObject({
				ok: false,
				code: "ZERO_VIDEOS",
			});
			expect(snapshot()).toBe(before);
		},
	);

	it.each(["ROOT_UNREADABLE", "FOLDER_NOT_AUTHORIZED", "SCAN_FAILED"])(
		"does not write on %s, including partial traversal errors",
		async (code) => {
			const { course } = await fixture();
			const before = snapshot();
			vi.mocked(scanCourse).mockRejectedValue({
				code,
				message: "Scan aborted",
			});
			expect(await syncCourse(course.id)).toEqual({
				ok: false,
				code,
				message: "Scan aborted",
			});
			expect(snapshot()).toBe(before);
		},
	);

	it("allows an empty new course and rejects nonexistent courses", async () => {
		const course = await courses.create({
			title: "Empty",
			root_path: "/empty",
		});
		vi.mocked(scanCourse).mockResolvedValue(found([]));
		expect(await syncCourse(course.id)).toMatchObject({
			ok: true,
			summary: { completed_count: 0, total_count: 0 },
		});
		expect(await syncCourse(9999)).toMatchObject({
			ok: false,
			code: "COURSE_NOT_FOUND",
		});
		expect(scanCourse).toHaveBeenCalledTimes(1);
	});

	it("handles multiple batches and never changes another course", async () => {
		const { course, first } = await fixture();
		const other = await courses.create({ title: "Other", root_path: "/other" });
		await lessons.upsertMany(other.id, [
			{ relative_path: "other.mp4", title: "Other", sort_order: 0 },
		]);
		const [otherLesson] = await lessons.listByCourse(other.id);
		vi.mocked(scanCourse).mockResolvedValue(
			found(Array.from({ length: 405 }, (_, index) => `Lesson ${index}.mp4`)),
		);
		expect(await syncCourse(course.id)).toMatchObject({
			ok: true,
			added_count: 405,
			missing_count: 2,
		});
		expect(await lessons.listByCourse(course.id)).toHaveLength(405);
		expect((await lessons.listByCourse(other.id))[0]).toEqual(otherLesson);
		expect(await notes.get(first.id)).not.toBeNull();
		await lessons.markMissing(course.id, [otherLesson.id]);
		expect((await lessons.listByCourse(other.id))[0]).toEqual(otherLesson);
	});

	it("coalesces overlapping syncs of the same course", async () => {
		const { course } = await fixture();
		vi.mocked(scanCourse).mockClear();
		const first = syncCourse(course.id);
		const second = syncCourse(course.id);
		expect(first).toBe(second);
		await first;
		expect(scanCourse).toHaveBeenCalledTimes(1);
	});
});
