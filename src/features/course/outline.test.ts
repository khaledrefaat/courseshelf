import { describe, expect, it } from "vitest";
import {
	buildOutline,
	courseDestination,
	parseId,
	sectionLabel,
} from "@/features/course/outline";
import type { CourseOutline, OutlineLesson } from "@/lib/db/courseOutline";

const lesson = (
	id: number,
	path: string,
	completed = false,
): OutlineLesson => ({
	id,
	course_id: 1,
	title: `Lesson ${id}`,
	relative_path: path,
	sort_order: id,
	completed,
	missing_at: null,
});
const rows = [
	lesson(1, "root.mp4", true),
	lesson(2, "02 Setup/one.mp4"),
	lesson(3, "02 Setup/two.mp4", true),
	lesson(4, "03 Advanced/Nested/one.webm"),
];
const course: CourseOutline = {
	course: {
		id: 1,
		title: "Course",
		root_path: "/course",
		cover_path: null,
		created_at: "",
	},
	lessons: rows,
};
describe("course outline and routing", () => {
	it("groups root and nested folders, preserves labels, counts and section position", () => {
		const model = buildOutline(rows, 3);
		expect(
			model.sections.map((section) => [
				section.name,
				section.label,
				section.completed,
				section.total,
			]),
		).toEqual([
			["", "Lessons", 1, 1],
			["02 Setup", "02 Setup", 1, 2],
			["03 Advanced/Nested", "03 Advanced / Nested", 0, 1],
		]);
		expect(model.position).toBe(2);
		expect(model.percent).toBe(50);
		expect(model.completed).toBe(2);
		expect(sectionLabel("01_Original-Name")).toBe("01_Original-Name");
	});
	it("navigates across sections, omits missing lessons and doesn't mutate input", () => {
		const input = [
			...rows,
			{ ...lesson(5, "removed.mp4"), missing_at: "2026-10-17" },
		].reverse();
		const model = buildOutline(input, 3);
		expect(model.previous?.id).toBe(2);
		expect(model.next?.id).toBe(4);
		expect(model.total).toBe(4);
		expect(buildOutline(input, 1).previous).toBeNull();
		expect(buildOutline(input, 4).next).toBeNull();
		expect(input[0].id).toBe(5);
	});
	it("handles empty and 200-lesson courses", () => {
		expect(buildOutline([], 1)).toMatchObject({
			total: 0,
			percent: 0,
			position: 0,
			previous: null,
			next: null,
		});
		const input = Array.from({ length: 200 }, (_, i) =>
			lesson(i + 1, `Section ${Math.floor(i / 20)}/${i}.mp4`),
		);
		expect(buildOutline(input, 101)).toMatchObject({
			total: 200,
			position: 1,
			previous: { id: 100 },
			next: { id: 102 },
		});
	});
	it("uses the summary resume destination, or first lesson to review a completed course", () => {
		expect(courseDestination(course, undefined, 3)).toEqual({
			kind: "redirect",
			lessonId: 3,
		});
		expect(courseDestination(course, undefined, null)).toEqual({
			kind: "redirect",
			lessonId: 1,
		});
		expect(
			courseDestination({ ...course, lessons: [] }, undefined, null),
		).toEqual({ kind: "empty" });
	});
	it("rejects unknown courses, unknown, foreign and missing lessons", () => {
		expect(courseDestination(null, "1", null).kind).toBe("not-found");
		expect(courseDestination(course, "99", null).kind).toBe("not-found");
		expect(
			courseDestination(
				{ ...course, lessons: [{ ...rows[0], course_id: 2 }] },
				"1",
				null,
			).kind,
		).toBe("not-found");
		expect(
			courseDestination(
				{ ...course, lessons: [{ ...rows[0], missing_at: "date" }] },
				"1",
				null,
			).kind,
		).toBe("not-found");
		expect(courseDestination(course, "2", null)).toEqual({
			kind: "lesson",
			lesson: rows[1],
		});
	});
	it.each(["0", "-1", "1.5", "abc", "1e2", "9007199254740992", ""])(
		"rejects invalid route ID %s",
		(raw) => expect(parseId(raw)).toBeNull(),
	);
});
