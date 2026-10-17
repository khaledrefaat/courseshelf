import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";
import { AllNotes } from "@/features/notes/AllNotes";
import { LessonNotes } from "@/features/notes/LessonNotes";
import { notesController } from "@/features/notes/store";

vi.mock("@/lib/db/notes", () => ({
	get: vi.fn(),
	save: vi.fn(),
	listByCourse: async () => [],
}));
beforeEach(async () => {
	await notesController.loadCourse(10, [
		{
			id: 101,
			title: "الدرس SQL",
			relative_path: "قسم/lesson.mp4",
			sort_order: 0,
		},
	]);
});
it("renders an auto-directional controlled textarea with the required placeholder and limit", () => {
	notesController.composition(101, true);
	notesController.edit(101, "  مرحبا SELECT الاسم\n ");
	const html = renderToStaticMarkup(
		createElement(LessonNotes, { lessonId: 101 }),
	);
	expect(html).toContain('dir="auto"');
	expect(html).toContain('maxLength="50000"');
	expect(html).toContain('placeholder="Write notes for this lesson..."');
	expect(html).toContain("مرحبا SELECT الاسم");
});
it("renders auto-directional All notes as escaped plain text, preserves line breaks, and provides Show more", () => {
	notesController.composition(101, true);
	notesController.edit(
		101,
		"<script>not executed</script>\nمرحبا SELECT الاسم\n".repeat(20),
	);
	const html = renderToStaticMarkup(
		createElement(MemoryRouter, {}, createElement(AllNotes, { courseId: 10 })),
	);
	expect(html).toContain('dir="auto"');
	expect(html).toContain("whitespace-pre-wrap");
	expect(html).toContain("&lt;script&gt;");
	expect(html).not.toContain("<script>");
	expect(html).toContain("Show more");
	expect(html).toContain("قسم · الدرس SQL");
});
