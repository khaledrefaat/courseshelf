import { describe, expect, it } from "vitest";
import { buildCourseStructure, comparePaths } from "@/lib/scanner/structure";

describe("buildCourseStructure", () => {
	it("sorts sections and lessons naturally by every path segment", () => {
		const result = buildCourseStructure([
			"10 - Intro/2.mp4",
			"2 - Setup/10.mp4",
			"2 - Setup/2.mp4",
			"2 - Setup/10 - Nested/1.mp4",
			"2 - Setup/2 - Nested/10.mp4",
			"2 - Setup/2 - Nested/2.mp4",
		]);
		expect(result.sections.map((section) => section.name)).toEqual([
			"2 - Setup",
			"2 - Setup/2 - Nested",
			"2 - Setup/10 - Nested",
			"10 - Intro",
		]);
		expect(result.lessons.map((lesson) => lesson.relative_path)).toEqual([
			"2 - Setup/2.mp4",
			"2 - Setup/10.mp4",
			"2 - Setup/2 - Nested/2.mp4",
			"2 - Setup/2 - Nested/10.mp4",
			"2 - Setup/10 - Nested/1.mp4",
			"10 - Intro/2.mp4",
		]);
		expect(result.lessons.map((lesson) => lesson.sort_order)).toEqual([
			0, 1, 2, 3, 4, 5,
		]);
		expect(comparePaths("2/10/2", "10/2/1")).toBeLessThan(0);
	});
	it("groups root-level videos under the empty section name", () => {
		const result = buildCourseStructure([
			"Section/1.mp4",
			"10 - Last.mp4",
			"2 - First.webm",
		]);
		expect(result.sections[0].name).toBe("");
		expect(result.sections[0].lessons.map((lesson) => lesson.title)).toEqual([
			"First",
			"Last",
		]);
		expect(result.lessons.map((lesson) => lesson.sort_order)).toEqual([
			0, 1, 2,
		]);
	});
	it("preserves the full parent folder path and exact folder spelling", () => {
		const result = buildCourseStructure([
			"01 - Section/02_Deep Folder/1_Test.M4V",
		]);
		expect(result.sections[0].name).toBe("01 - Section/02_Deep Folder");
		expect(result.lessons[0]).toEqual({
			relative_path: "01 - Section/02_Deep Folder/1_Test.M4V",
			title: "Test",
			sort_order: 0,
		});
	});
	it("counts ignored file paths including hidden paths and unsupported extensions", () => {
		const ignored = [
			"notes.pdf",
			"captions.srt",
			"archive.zip",
			".DS_Store",
			".hidden.mp4",
			".cache/movie.mp4",
			"Section/.private/movie.webm",
			"movie.avi",
			"../outside.mp4",
		];
		const result = buildCourseStructure([
			...ignored,
			"one.mp4",
			"two.M4V",
			"three.WEBM",
		]);
		expect(result.ignored_count).toBe(ignored.length);
		expect(result.lessons).toHaveLength(3);
	});
	it("counts subtitle sidecars as non-lessons without warning they are unsupported", () => {
		const result = buildCourseStructure([
			"lesson.mp4",
			"lesson.en.vtt",
			"lesson.srt",
			"notes.pdf",
		]);
		expect(result.lessons).toHaveLength(1);
		expect(result.ignored_count).toBe(3);
		expect(result.ignored_by_extension).toEqual({ ".pdf": 1 });
	});
	it.each([
		["01 - Welcome.mp4", "Welcome"],
		["01. Overview.m4v", "Overview"],
		["1_Setup.webm", "Setup"],
		["2024 Updates.mp4", "2024 Updates"],
		["Part 2.mp4", "Part 2"],
		["Welcome.mp4", "Welcome"],
	])(
		"strips only a leading numeric separator prefix from %s",
		(file, title) => {
			expect(buildCourseStructure([file]).lessons[0].title).toBe(title);
		},
	);
	it("returns an empty structure for an empty folder", () => {
		expect(buildCourseStructure([])).toEqual({
			sections: [],
			lessons: [],
			ignored_count: 0,
			ignored_by_extension: {},
		});
	});
});
