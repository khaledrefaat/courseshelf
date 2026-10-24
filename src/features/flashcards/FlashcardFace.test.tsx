import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { FlashcardFace } from "@/features/flashcards/FlashcardFace";
import { initialReview, reviewState } from "@/features/flashcards/reviewState";
import type { SavedCard } from "@/lib/db/flashcards";

const card: SavedCard = {
	id: 1,
	edited: false,
	question: "What is recursion?",
	answer: "A function calling itself.",
	extraContext: "A smaller subproblem approaches a base case.",
	evidence: [],
};
it.each([false, true])(
	"renders exactly one readable text face and one keyboard flip button (revealed=%s)",
	(revealed) => {
		const html = renderToStaticMarkup(
			<FlashcardFace card={card} revealed={revealed} onFlip={() => {}} />,
		);
		expect(html).toContain(`data-revealed="${revealed}"`);
		expect(html.match(/<button /g)).toHaveLength(1);
		expect(html).toContain(revealed ? card.answer : card.question);
		expect(html).not.toContain(revealed ? card.question : card.answer);
		if (revealed) {
			expect(html).toContain(card.extraContext);
			expect(html).toContain("AI-added context · Not independently verified");
		} else {
			expect(html).not.toContain(card.extraContext);
			expect(html).not.toContain("AI-added context");
		}
		expect(html).not.toContain("Click");
		expect(html).not.toContain("<details");
		expect(html).not.toContain("flashcard-back");
		expect(html).toContain(
			`aria-label="${revealed ? "Show question" : "Reveal answer"}"`,
		);
	},
);
it("escapes card text instead of interpreting subtitle/model HTML", () => {
	const html = renderToStaticMarkup(
		<FlashcardFace
			card={{
				...card,
				answer: "<script>test</script>",
				extraContext: "<b>context</b>",
			}}
			revealed
			onFlip={() => {}}
		/>,
	);
	expect(html).toContain("&lt;script&gt;");
	expect(html).not.toContain("<script>");
	expect(html).toContain("&lt;b&gt;context&lt;/b&gt;");
	expect(html).not.toContain("<b>");
});
it("does not show an empty context section when none was saved", () => {
	const html = renderToStaticMarkup(
		<FlashcardFace
			card={{ ...card, extraContext: null }}
			revealed
			onFlip={() => {}}
		/>,
	);
	expect(html).not.toContain("flashcard-context");
	expect(html).toContain(card.answer);
});
it("flips once per action and resets to the question after navigation/deletion", () => {
	const back = reviewState(initialReview, { type: "flip" });
	expect(back.revealed).toBe(true);
	expect(reviewState(back, { type: "flip" })).toEqual(initialReview);
	expect(reviewState(back, { type: "move", index: 6 })).toEqual({
		index: 6,
		revealed: false,
	});
	expect(reviewState(back, { type: "hideAnswer" }).revealed).toBe(false);
	expect(reviewState(back, { type: "move", index: -1 }).index).toBe(0);
});
it("bounds content, keeps the popup transparent, and never depends on reversed 3D backfaces", () => {
	const css = readFileSync(new URL("./flashcard.css", import.meta.url), "utf8");
	expect(css).toContain("overflow-y: auto");
	expect(css).toContain("background: transparent");
	expect(css).toContain("var(--review)");
	expect(css).toContain("scaleX(0.03)");
	expect(css).not.toMatch(/rotateY|preserve-3d|backface|scaleX\(-/);
	expect(css).toContain("prefers-reduced-motion: reduce");
	expect(css).toContain("animation: none");
	expect(css).not.toMatch(/#[a-f\d]{3,8}\b/i);
});
it("keeps light review surfaces white and follows the app palette in dark mode", () => {
	const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8");
	expect(css).toContain("--review: #ffffff;");
	expect(css).toContain("--review-foreground: #18181b;");
	expect(css).toContain("--review-accent: #843b68;");
	const dark = css.slice(css.indexOf(".dark {"), css.indexOf("@theme"));
	expect(dark).toContain("--review: var(--card);");
	expect(dark).toContain("--review-foreground: var(--card-foreground);");
	expect(dark).toContain("--review-accent: var(--brand);");
	expect(dark).toContain("--review-muted: var(--muted-foreground);");
	expect(dark).toContain("--review-border: var(--border);");
	expect(dark).toContain("--review-hover: var(--accent);");
	expect(dark).toContain(
		"--review-action-foreground: var(--brand-foreground);",
	);
});
