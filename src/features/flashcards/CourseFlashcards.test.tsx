import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { CourseFlashcardStatus } from "@/features/flashcards/CourseFlashcardStatus";
import { CourseFlashcardsDialog } from "@/features/flashcards/CourseFlashcardsDialog";
import { FlashcardKeyDialog } from "@/features/flashcards/FlashcardKeyDialog";
import {
	courseFlashcards,
	sessionKey,
	useCourseFlashcards,
} from "@/features/flashcards/service";

vi.mock("@/features/flashcards/service", () => ({
	useCourseFlashcards: vi.fn(),
	useFlashcards: () => ({ job: null, keyReady: false }),
	courseFlashcards: { prepare: vi.fn(), start: vi.fn(), dismiss: vi.fn() },
	sessionKey: vi.fn(),
	cancelFlashcards: vi.fn(),
}));
vi.mock("@/components/ui/dialog", () => {
	const Pass = ({ children }: { children: ReactNode }) => <div>{children}</div>;
	return {
		Dialog: Pass,
		DialogContent: Pass,
		DialogDescription: Pass,
		DialogHeader: Pass,
		DialogTitle: Pass,
	};
});
beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(useCourseFlashcards).mockReturnValue(null);
});
it("shows read-only preparation first and cannot start a batch before preview/consent/key", () => {
	const html = renderToStaticMarkup(
		<CourseFlashcardsDialog
			course={{
				id: 1,
				title: "My course",
				root_path: "/private",
				cover_path: null,
				created_at: "created",
			}}
			onClose={() => {}}
		/>,
	);
	expect(html).toContain("Generate course flashcards");
	expect(html).toContain("Only missing sets are generated");
	expect(html).toContain("No API requests are sent during preview");
	expect(html).toMatch(/<button[^>]*disabled[^>]*>Generate missing flashcards/);
	expect(html).not.toContain("/private");
	expect(courseFlashcards.start).not.toHaveBeenCalled();
	expect(sessionKey).not.toHaveBeenCalled();
});
it("shows completion issues and unknown usage without pretending they are free or billing estimates", () => {
	vi.mocked(useCourseFlashcards).mockReturnValue({
		courseId: 1,
		title: "Course <test>",
		running: false,
		cancelled: false,
		stopped: true,
		total: 3,
		processed: 2,
		generated: 1,
		resumed: 1,
		skipped: 0,
		failed: 1,
		current: "",
		requests: 2,
		maximumRequests: 5,
		newTokens: 15,
		reusedTokens: 10,
		unknownUsage: 1,
		errors: ["HTTP failure"],
	});
	const html = renderToStaticMarkup(<CourseFlashcardStatus />);
	expect(html).toContain("Flashcard queue stopped");
	expect(html).toContain("Course &lt;test&gt;");
	expect(html).toContain("1 request(s) with unknown usage");
	expect(html).toContain("Not a package-billing estimate");
	expect(html).toContain("HTTP failure");
	expect(html).toContain("Dismiss");
	expect(html).not.toContain("Cancel</button>");
});
it("reuses a private session-only password dialog with no secret in the rendered markup", () => {
	const html = renderToStaticMarkup(<FlashcardKeyDialog onClose={() => {}} />);
	expect(html).toContain('type="password"');
	expect(html).toContain('autoComplete="off"');
	expect(html).toContain("Never saved in the database");
	expect(html).toContain('value=""');
	expect(sessionKey).not.toHaveBeenCalled();
});
