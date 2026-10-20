import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { NextLessonCountdown } from "@/features/course/NextLessonCountdown";

it("renders countdown seconds, a themed SVG ring and an accessible cancel action", () => {
	const html = renderToStaticMarkup(
		<NextLessonCountdown
			state={{ seconds: 3, flushing: false }}
			title="Next lesson"
			onCancel={() => {}}
			onAdvance={() => {}}
		/>,
	);
	expect(html).toContain("Next lesson in 3 seconds");
	expect(html).toContain('stroke-dashoffset="60"');
	expect(html).toContain("text-countdown-brand");
	expect(html).toContain('aria-keyshortcuts="S"');
	expect(html).toContain('aria-label="Cancel"');
	expect(html).toContain('title="Cancel (S)"');
	expect(html).toContain('aria-label="Play next lesson now: Next lesson"');
	// Separate sibling buttons: cancelling must never activate the advance action.
	expect(html.match(/<button\b/g)).toHaveLength(2);
	expect(html).toMatch(
		/Play next lesson now:[\s\S]*?<\/button>[\s\S]*?aria-label="Cancel"/,
	);
});

it("truncates long mixed-language titles to one line while preserving the full title", () => {
	const title = "الدرس التالي Introduction to SQLite ".repeat(20);
	const html = renderToStaticMarkup(
		<NextLessonCountdown
			state={{ seconds: 5, flushing: false }}
			title={title}
			onCancel={() => {}}
			onAdvance={() => {}}
		/>,
	);
	expect(html).toContain("truncate");
	expect(html).toContain(`title="${title}"`);
	expect(html).toContain('dir="auto"');
});

it("keeps cancel available while saves settle, with a full ring, spinner and no zero countdown", () => {
	const html = renderToStaticMarkup(
		<NextLessonCountdown
			state={{ seconds: 0, flushing: true }}
			title="Next lesson"
			onCancel={() => {}}
			onAdvance={() => {}}
		/>,
	);
	expect(html).toContain("Starting next lesson");
	expect(html).toContain("Starting…");
	expect(html).toContain("animate-spin");
	expect(html).toContain("next-lesson-countdown-ready");
	expect(html).toContain('stroke-dashoffset="0"');
	expect(html).not.toContain("in 0 seconds");
	expect(html).toContain('aria-label="Cancel"');
	expect(html).toMatch(
		/<button[^>]*disabled=""[^>]*aria-label="Play next lesson now:/,
	);
});

it("offers review as a separate button without nesting it inside next/cancel", () => {
	const html = renderToStaticMarkup(
		<NextLessonCountdown
			state={{ seconds: 4, flushing: false }}
			title="Next lesson"
			onCancel={() => {}}
			onAdvance={() => {}}
			onReview={() => {}}
		/>,
	);
	expect(html.match(/<button\b/g)).toHaveLength(3);
	expect(html).toMatch(
		/Play next lesson now:[\s\S]*?<\/button>[\s\S]*?Review cards[\s\S]*?<\/button>[\s\S]*?aria-label="Cancel"/,
	);
});
