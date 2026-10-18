import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { NextLessonCountdown } from "@/features/course/NextLessonCountdown";

it("renders countdown seconds, a themed SVG ring and an accessible cancel action", () => {
	const html = renderToStaticMarkup(
		<NextLessonCountdown
			state={{ seconds: 3, flushing: false }}
			title="Next lesson"
			onCancel={() => {}}
		/>,
	);
	expect(html).toContain("Next lesson in 3 seconds");
	expect(html).toContain('stroke-dashoffset="60"');
	expect(html).toContain("text-brand");
	expect(html).toContain('aria-keyshortcuts="S"');
	expect(html).toContain("Cancel");
});

it("wraps long mixed-language titles to two lines while preserving the full title", () => {
	const title = "الدرس التالي Introduction to SQLite ".repeat(20);
	const html = renderToStaticMarkup(
		<NextLessonCountdown
			state={{ seconds: 5, flushing: false }}
			title={title}
			onCancel={() => {}}
		/>,
	);
	expect(html).toContain("line-clamp-2");
	expect(html).toContain("wrap-anywhere");
	expect(html).toContain(`title="${title}"`);
	expect(html).toContain('dir="auto"');
});

it("keeps cancel available while saves settle, with a full ring and no zero countdown", () => {
	const html = renderToStaticMarkup(
		<NextLessonCountdown
			state={{ seconds: 0, flushing: true }}
			title="Next lesson"
			onCancel={() => {}}
		/>,
	);
	expect(html).toContain("Starting next lesson");
	expect(html).toContain("next-lesson-countdown-ready");
	expect(html).toContain('stroke-dashoffset="0"');
	expect(html).not.toContain("in 0 seconds");
	expect(html).toContain("Cancel");
});
