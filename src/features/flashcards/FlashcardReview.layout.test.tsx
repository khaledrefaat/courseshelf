import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { FlashcardDetails } from "@/features/flashcards/FlashcardDetails";
import { FlashcardReview } from "@/features/flashcards/FlashcardReview";
import type { FlashcardSet } from "@/lib/db/flashcards";

let requestOpenChange: (open: boolean) => void;

// Render inside the otherwise browser-only portal to inspect the real review
// markup. The separate SSR test still exercises the unmocked Base UI dialog.
vi.mock("@/components/ui/dialog", () => ({
	Dialog: ({
		children,
		onOpenChange,
	}: {
		children: ReactNode;
		onOpenChange(open: boolean): void;
	}) => {
		requestOpenChange = onOpenChange;
		return <div>{children}</div>;
	},
	DialogContent: ({
		children,
		className,
	}: {
		children: ReactNode;
		className: string;
	}) => <section className={className}>{children}</section>,
	DialogTitle: ({
		children,
		className,
	}: {
		children: ReactNode;
		className: string;
	}) => <h2 className={className}>{children}</h2>,
	DialogDescription: ({
		children,
		className,
	}: {
		children: ReactNode;
		className: string;
	}) => <p className={className}>{children}</p>,
}));
const set: FlashcardSet = {
	id: 1,
	lessonId: 1,
	generationId: "saved-old-set",
	model: "glm-5.3-flash",
	promptVersion: "6",
	validatorVersion: "6",
	sourceHash: "old",
	sourceFingerprint: "old",
	sourceName: "lesson.vtt",
	updatedAt: "",
	notes: "",
	usage: { newRequests: [], reusedRequests: [] },
	cards: Array.from({ length: 8 }, (_, index) => ({
		id: index + 1,
		edited: true,
		question: `Saved question ${index + 1}`,
		answer: "Preserve my saved answer",
		extraContext: "My context",
		evidence: [],
	})),
};
it("removes the visible banner and first-five cutoff without modifying old saved content", () => {
	const html = renderToStaticMarkup(
		<FlashcardReview set={set} onClose={() => {}} onChanged={async () => {}} />,
	);
	expect(html).toContain('class="sr-only">Lesson review');
	expect(html).not.toContain("Quick review");
	expect(html).not.toContain("AI-generated learning aids.");
	expect(html).toContain("Card 1 of 8");
	expect(html).toContain("Edited by you");
	expect(html).not.toContain("Hide review");
	expect(html).not.toContain("Next lesson");
	expect(html).not.toContain("Click card to reveal answer");
	expect(html).not.toContain("flashcard-flip-hint");
	expect(html).not.toContain("flashcard-side");
	expect(html).toContain('class="flashcard-review"');
	expect(html).toContain('class="flashcard-stage"');
	expect(html).toContain(">Previous card</button>");
	expect(html).toContain(">Next card</button>");
	const previous = html.match(/<button\b[^>]*>Previous card<\/button>/)?.[0];
	const next = html.match(/<button\b[^>]*>Next card<\/button>/)?.[0];
	expect(previous).toMatch(/\sdisabled(?:=|\s|>)/);
	expect(next).not.toMatch(/\sdisabled(?:=|\s|>)/);
	expect(html).toContain("Press Escape to close the review");
	expect(html).toContain('class="flashcard-actions"');
	expect(html).toContain("Details");
	expect(html).not.toContain("Preserve my saved answer");
	expect(html).not.toContain("My context");
	expect(set.cards[0].answer).toBe("Preserve my saved answer");
	expect(set.cards[0].extraContext).toBe("My context");
	expect(set.promptVersion).toBe("6");
});
it("keeps lesson evidence and editing in Details, without duplicating on-card AI context", () => {
	const html = renderToStaticMarkup(
		<FlashcardDetails
			id="details"
			set={set}
			card={set.cards[0]}
			disabled={false}
			onBusyChange={() => {}}
			onChanged={async () => {}}
		/>,
	);
	expect(html).not.toContain("My context");
	expect(html).not.toContain("AI-added context · Not independently verified");
	expect(html).toContain("Lesson evidence");
	expect(html).toContain("Edit card");
	expect(html).toContain("Delete card");
	expect(html).not.toContain("flashcard-face");
});
it.each([{ cards: [] }, { cards: [set.cards[0]] }])(
	"disables both navigation buttons for an empty or single-card set without lesson/close buttons",
	({ cards }) => {
		const html = renderToStaticMarkup(
			<FlashcardReview
				set={{ ...set, cards }}
				onClose={() => {}}
				onChanged={async () => {}}
			/>,
		);
		if (!cards.length) expect(html).toContain("No cards remain");
		expect(html.match(/<button\b[^>]*>Previous card<\/button>/)?.[0]).toMatch(
			/\sdisabled(?:=|\s|>)/,
		);
		expect(html.match(/<button\b[^>]*>Next card<\/button>/)?.[0]).toMatch(
			/\sdisabled(?:=|\s|>)/,
		);
		expect(html).not.toContain(">Done</button>");
		expect(html).not.toContain("Hide review");
		expect(html).not.toContain("Next lesson");
	},
);
it("keeps dialog dismissal available without advancing lessons or changing saved cards", () => {
	const close = vi.fn(),
		changed = vi.fn();
	const before = JSON.stringify(set);
	renderToStaticMarkup(
		<FlashcardReview set={set} onClose={close} onChanged={changed} />,
	);
	requestOpenChange(false); // Base UI dispatches this on Escape/dismissal.
	expect(close).toHaveBeenCalledOnce();
	expect(changed).not.toHaveBeenCalled();
	expect(JSON.stringify(set)).toBe(before);
});
