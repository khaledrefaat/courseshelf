import { describe, expect, it } from "vitest";
import {
	continueCourse,
	courseStatus,
	filterCourses,
	progressPercent,
	sortCourses,
} from "@/features/library/model";
import { coverGradient, coverLabel } from "@/lib/cover-gradients";
import type { CourseSummary } from "@/lib/db/courseSummaries";

const fresh: CourseSummary = {
	id: 1,
	title: "Course 10",
	cover_path: null,
	created_at: "2026-10-15 10:00:00",
	archived_at: null,
	total_lessons: 3,
	duration_seconds: null,
	completed_lessons: 0,
	last_watched_at: null,
	resume_lesson_id: 1,
	resume_lesson_title: "First",
};
const watching: CourseSummary = {
	...fresh,
	id: 2,
	title: "Course 2",
	completed_lessons: 1,
	last_watched_at: "2026-10-16 10:00:00",
	created_at: "2026-10-17 10:00:00",
};
const completed: CourseSummary = {
	...fresh,
	id: 3,
	title: "Arabic العربية",
	completed_lessons: 3,
	last_watched_at: "2026-10-17 10:00:00",
	resume_lesson_id: null,
};

describe("library pure functions", () => {
	it("distinguishes new, watched with no completions, partial and completed", () => {
		expect(courseStatus(fresh)).toBe("New");
		expect(courseStatus({ ...watching, completed_lessons: 0 })).toBe(
			"In progress",
		);
		expect(courseStatus(watching)).toBe("In progress");
		expect(courseStatus(completed)).toBe("Completed");
		expect(courseStatus({ ...fresh, total_lessons: 0 })).toBe("New");
	});
	it("rounds progress, including empty courses", () => {
		expect(progressPercent(watching)).toBe(33);
		expect(progressPercent(completed)).toBe(100);
		expect(progressPercent({ ...fresh, total_lessons: 0 })).toBe(0);
	});
	it("filters by status and trimmed case-insensitive title only", () => {
		expect(
			filterCourses([fresh, watching, completed], "All", "  COURSE  "),
		).toEqual([fresh, watching]);
		expect(filterCourses([fresh, watching], "New", "course")).toEqual([fresh]);
		expect(filterCourses([fresh], "All", "First")).toEqual([]);
		expect(filterCourses([completed], "Completed", "العربية")).toEqual([
			completed,
		]);
	});
	it("keeps archived courses out of every tab except Archived", () => {
		const archived: CourseSummary = {
			...watching,
			id: 4,
			title: "Course 4",
			archived_at: "2026-10-18 10:00:00",
		};
		expect(filterCourses([fresh, archived, watching], "All", "")).toEqual([
			fresh,
			watching,
		]);
		expect(
			filterCourses([fresh, archived, watching], "In progress", ""),
		).toEqual([watching]);
		expect(filterCourses([fresh, archived], "Archived", "")).toEqual([
			archived,
		]);
		expect(filterCourses([fresh, archived], "Archived", "course 4")).toEqual([
			archived,
		]);
		expect(filterCourses([fresh], "Archived", "")).toEqual([]);
	});
	it("supports all sorts without mutating input and places unwatched last", () => {
		const input = [fresh, watching, completed];
		expect(sortCourses(input, "Last watched").map((c) => c.id)).toEqual([
			3, 2, 1,
		]);
		expect(sortCourses(input, "Title").map((c) => c.id)).toEqual([3, 2, 1]);
		expect(sortCourses(input, "Progress").map((c) => c.id)).toEqual([3, 2, 1]);
		expect(sortCourses(input, "Recently added")[0]).toBe(watching);
		expect(input).toEqual([fresh, watching, completed]);
	});
	it("continues the latest watched non-completed course only", () => {
		expect(continueCourse([fresh, watching, completed])).toBe(watching);
		expect(continueCourse([fresh, completed])).toBeUndefined();
	});
	it("creates stable gradients and short first-word labels", () => {
		expect(coverGradient(1)).toBe(coverGradient(9));
		expect(coverGradient(1)).not.toBe(coverGradient(2));
		expect(coverLabel("  PostgreSQL from Scratch")).toBe("Postgre");
		expect(coverLabel("العربية درس")).toBe("العربية");
	});
});
