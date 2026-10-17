import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import { CourseCard } from "@/features/library/CourseCard";
import type { CourseSummary } from "@/lib/db/courseSummaries";

it("keeps Edit cover and Delete controls outside the course navigation link", () => {
	const course: CourseSummary = {
		id: 1,
		title: "SQL",
		created_at: "",
		cover_path: null,
		completed_lessons: 0,
		total_lessons: 2,
		last_watched_at: null,
		resume_lesson_id: 1,
		resume_lesson_title: "One",
	};
	const html = renderToStaticMarkup(
		createElement(
			MemoryRouter,
			null,
			createElement(CourseCard, {
				course,
				onEditCover: () => {},
				onDelete: () => {},
			}),
		),
	);
	expect(html).toContain('aria-label="Edit cover for SQL"');
	expect(html).toContain('aria-label="Delete course SQL"');
	const link = html.slice(html.indexOf("<a "), html.indexOf("</a>"));
	expect(link).not.toContain("<button");
	expect(html.indexOf('aria-label="Edit cover for SQL"')).toBeGreaterThan(
		html.indexOf("</a>"),
	);
});
