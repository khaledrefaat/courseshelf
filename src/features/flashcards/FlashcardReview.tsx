import { Info } from "lucide-react";
import { useId, useReducer, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
import { FlashcardDetails } from "@/features/flashcards/FlashcardDetails";
import { FlashcardFace } from "@/features/flashcards/FlashcardFace";
import { initialReview, reviewState } from "@/features/flashcards/reviewState";
import type { FlashcardSet } from "@/lib/db/flashcards";

export function FlashcardReview({
	set,
	onClose,
	onChanged,
}: {
	set: FlashcardSet;
	onClose(): void;
	onChanged(): Promise<void>;
}) {
	const [{ index, revealed }, dispatch] = useReducer(
		reviewState,
		initialReview,
	);
	const [details, setDetails] = useState(false);
	const [saving, setSaving] = useState(false);
	const detailsId = useId();
	const busy = saving;
	const cards = set.cards;
	const position = Math.min(index, Math.max(0, cards.length - 1)),
		card = cards[position];
	function move(next: number) {
		dispatch({ type: "move", index: next });
		setDetails(false);
	}
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy) onClose();
			}}
		>
			<DialogContent className="flashcard-review" showCloseButton={false}>
				<DialogTitle className="sr-only">Lesson review</DialogTitle>
				<DialogDescription className="sr-only">
					Click the card or press Enter or Space to flip it. Press Escape to
					close the review.
				</DialogDescription>
				{card ? (
					<>
						<p aria-live="polite" className="flashcard-counter">
							Card {position + 1} of {cards.length}
							{card.edited ? " · Edited by you" : ""}
						</p>
						<div className="flashcard-stage">
							<FlashcardFace
								key={card.id}
								card={card}
								revealed={revealed}
								disabled={busy}
								onFlip={() => {
									setDetails(false);
									dispatch({ type: "flip" });
								}}
							/>
						</div>
					</>
				) : (
					<p className="flashcard-empty">No cards remain in this set.</p>
				)}
				<div className="flashcard-actions">
					<Button
						variant="outline"
						className="flashcard-floating flashcard-previous"
						disabled={!card || position === 0 || busy}
						onClick={() => move(position - 1)}
					>
						Previous card
					</Button>
					{card && (
						<Button
							variant="outline"
							className="flashcard-floating flashcard-details-toggle"
							disabled={!revealed || busy}
							aria-expanded={details}
							aria-controls={detailsId}
							title={
								revealed
									? "Lesson evidence and editing"
									: "Reveal the answer first"
							}
							onClick={() => setDetails(!details)}
						>
							<Info aria-hidden="true" /> Details
						</Button>
					)}
					<Button
						className="flashcard-floating flashcard-continue flashcard-next"
						disabled={!card || position === cards.length - 1 || busy}
						onClick={() => move(position + 1)}
					>
						Next card
					</Button>
				</div>
				{details && revealed && card && (
					<FlashcardDetails
						key={card.id}
						id={detailsId}
						set={set}
						card={card}
						disabled={busy}
						onBusyChange={setSaving}
						onChanged={async (removed) => {
							await onChanged();
							if (removed) {
								dispatch({ type: "hideAnswer" });
								setDetails(false);
							}
						}}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}
