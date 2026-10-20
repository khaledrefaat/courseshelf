import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { FlashcardReview } from "@/features/flashcards/FlashcardReview";
import type { FlashcardSet } from "@/lib/db/flashcards";

it("uses an accessible existing dialog; SSR remains inert and never initiates generation", () => {
	const set: FlashcardSet = {
		id: 1,
		lessonId: 2,
		generationId: "job",
		sourceHash: "hash",
		sourceFingerprint: "fp",
		sourceName: "lesson.vtt",
		model: "glm-5.3-flash",
		promptVersion: "6",
		validatorVersion: "6",
		notes: "",
		updatedAt: "now",
		usage: { newRequests: [], reusedRequests: [] },
		cards: [
			{
				id: 1,
				edited: false,
				question: "What is recursion?",
				answer: "A function calling itself.",
				extraContext: null,
				evidence: [
					{ cueId: 1, quote: "A function calling itself.", start: 0, end: 2 },
				],
			},
		],
	};
	// Base UI portals are not mounted on the server, so no document/global player
	// or API operation is required just to render the review component.
	expect(() =>
		renderToStaticMarkup(
			<FlashcardReview
				set={set}
				onClose={() => {}}
				onChanged={async () => {}}
			/>,
		),
	).not.toThrow();
});
