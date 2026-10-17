import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import { CourseSidebar } from "@/features/course/CourseSidebar";
import { buildOutline } from "@/features/course/outline";
import type { OutlineLesson } from "@/lib/db/courseOutline";
import type { Course } from "@/lib/db/courses";

it("renders accessible ring, expanded current section and keyboard-operable current lesson", () => {
	const course: Course = {
		id: 1,
		title: "Course",
		root_path: "/course",
		cover_path: null,
		created_at: "",
	};
	const lessons: OutlineLesson[] = [
		{
			id: 1,
			course_id: 1,
			title: "One",
			relative_path: "root.mp4",
			sort_order: 0,
			completed: true,
			missing_at: null,
		},
		{
			id: 2,
			course_id: 1,
			title: "Two",
			relative_path: "Nested/Section/two.mp4",
			sort_order: 1,
			completed: false,
			missing_at: null,
		},
	];
	const html = renderToStaticMarkup(
		createElement(
			MemoryRouter,
			null,
			createElement(CourseSidebar, {
				course,
				model: buildOutline(lessons, 2),
				lessonId: 2,
			}),
		),
	);
	expect(html).toContain('role="progressbar"');
	expect(html).toContain('aria-valuenow="50"');
	expect(html).toContain('aria-valuemin="0"');
	expect(html).toContain('aria-valuemax="100"');
	expect(html).toContain('aria-expanded="true"');
	expect(html).toContain('aria-expanded="false"');
	expect(html).toContain('aria-current="page"');
	expect(html).toContain('href="/course/1/lesson/2"');
	expect(html).toContain("Nested / Section");
	expect(html).not.toContain('href="/course/1/lesson/1"');
});
