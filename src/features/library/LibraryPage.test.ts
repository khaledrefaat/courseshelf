import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";
import { LibraryPage } from "@/features/library/LibraryPage";
import { useLibrary } from "@/features/library/useLibrary";
import type { CourseSummary } from "@/lib/db/courseSummaries";

vi.mock("@/features/library/useLibrary", () => ({ useLibrary: vi.fn() }));
const course: CourseSummary = {
	id: 1,
	title: "SQLite",
	cover_path: null,
	created_at: "2026-10-17 10:00:00",
	archived_at: null,
	total_lessons: 4,
	completed_lessons: 1,
	last_watched_at: "2026-10-17 10:00:00",
	resume_lesson_id: 2,
	resume_lesson_title: "Indexes",
};
beforeEach(() => {
	vi.mocked(useLibrary).mockReturnValue({
		courses: [course],
		error: null,
		registrationError: null,
		registrations: new Map([
			[1, { courseId: 1, status: "registered", message: "Registered" }],
		]),
	});
});
const render = (search = "") =>
	renderToStaticMarkup(
		createElement(MemoryRouter, null, createElement(LibraryPage, { search })),
	);

it("links Resume and cards to their placeholder routes", () => {
	const html = render();
	expect(html).toContain('href="/course/1/lesson/2"');
	expect(html).toContain('href="/course/1"');
	expect(html).toContain("Indexes");
	expect(html).toContain("25%");
});
it.each(["unauthorized", "missing"] as const)(
	"disables Resume and shows a %s folder warning",
	(status) => {
		vi.mocked(useLibrary).mockReturnValue({
			courses: [course],
			error: null,
			registrationError: null,
			registrations: new Map([
				[1, { courseId: 1, status, message: "Unavailable" }],
			]),
		});
		const html = render();
		expect(html).not.toContain('href="/course/1/lesson/2"');
		expect(html).toContain("disabled");
		expect(html).toContain(
			status === "missing" ? "Folder missing" : "Folder not authorized",
		);
	},
);
it("shows no-match text rather than an empty shelf when a search fails", () => {
	const html = render("not SQLite");
	expect(html).toContain("No courses match");
	expect(html).not.toContain("Your shelf is empty");
});
it("keeps archived courses off the shelf and on their own tab", () => {
	vi.mocked(useLibrary).mockReturnValue({
		courses: [
			course,
			{
				...course,
				id: 2,
				title: "Old SQLite",
				archived_at: "2026-10-18 09:00:00",
			},
		],
		error: null,
		registrationError: null,
		registrations: new Map(),
	});
	const html = render();
	expect(html).toContain("SQLite");
	expect(html).not.toContain("Old SQLite");
	expect(html).toContain("All · 1");
	expect(html).toContain("Archived · 1");
});
it("shows the empty shelf only for an empty database", () => {
	vi.mocked(useLibrary).mockReturnValue({
		courses: [],
		error: null,
		registrationError: null,
		registrations: new Map(),
	});
	const html = render("search");
	expect(html).toContain("Your shelf is empty");
	expect(html).toContain("Add your first course");
	expect(html).not.toContain("No courses match");
});
it("does not confuse a load failure with an empty database", () => {
	vi.mocked(useLibrary).mockReturnValue({
		courses: null,
		error: "Database unavailable",
		registrationError: null,
		registrations: new Map(),
	});
	expect(render()).toContain("Database unavailable");
	expect(render()).not.toContain("Your shelf is empty");
});
