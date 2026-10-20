import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	deleteFlashcard,
	editFlashcard,
	type FlashcardSet,
	type SavedCard,
} from "@/lib/db/flashcards";
import { MAX_EXTRA_CONTEXT_CHARACTERS } from "@/lib/flashcards/core";
import { timestamp } from "@/lib/flashcards/pipeline";

export function FlashcardDetails({
	id,
	set,
	card,
	disabled,
	onBusyChange,
	onChanged,
}: {
	id: string;
	set: FlashcardSet;
	card: SavedCard;
	disabled: boolean;
	onBusyChange(busy: boolean): void;
	onChanged(removed: boolean): Promise<void>;
}) {
	const [editing, setEditing] = useState(false),
		[deleting, setDeleting] = useState(false);
	const [draft, setDraft] = useState({
		question: card.question,
		answer: card.answer,
		extraContext: card.extraContext ?? "",
	});
	const [error, setError] = useState<string | null>(null);
	const saving = useRef(false);
	async function write(remove: boolean) {
		if (saving.current || disabled) return;
		saving.current = true;
		onBusyChange(true);
		setError(null);
		try {
			if (remove) await deleteFlashcard(set, card.id);
			else
				await editFlashcard(
					set,
					card.id,
					draft.question,
					draft.answer,
					draft.extraContext || null,
				);
			await onChanged(remove);
			setEditing(false);
			setDeleting(false);
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Could not save this card.",
			);
		} finally {
			saving.current = false;
			onBusyChange(false);
		}
	}
	return (
		<section
			id={id}
			aria-label="Card details"
			className="flashcard-details"
			aria-busy={saving.current}
		>
			{editing ? (
				<div className="space-y-3">
					<Label htmlFor="flashcard-question">Question</Label>
					<Input
						id="flashcard-question"
						className="flashcard-edit-field"
						maxLength={300}
						disabled={disabled}
						value={draft.question}
						onChange={(e) => setDraft({ ...draft, question: e.target.value })}
					/>
					<Label htmlFor="flashcard-answer">Answer</Label>
					<textarea
						id="flashcard-answer"
						className="flashcard-edit-field w-full rounded-lg border p-3"
						maxLength={1500}
						rows={5}
						disabled={disabled}
						value={draft.answer}
						onChange={(e) => setDraft({ ...draft, answer: e.target.value })}
					/>
					<Label htmlFor="flashcard-context">Optional extra context</Label>
					<textarea
						id="flashcard-context"
						className="flashcard-edit-field w-full rounded-lg border p-3"
						maxLength={MAX_EXTRA_CONTEXT_CHARACTERS}
						rows={3}
						disabled={disabled}
						value={draft.extraContext}
						onChange={(e) =>
							setDraft({ ...draft, extraContext: e.target.value })
						}
					/>
					<p className="flashcard-details-note text-xs">
						Original transcript evidence stays unchanged when you edit.
					</p>
					<div className="flex flex-wrap gap-2">
						<Button
							className="flashcard-floating"
							disabled={disabled}
							onClick={() => void write(false)}
						>
							Save changes
						</Button>
						<Button
							className="flashcard-floating"
							disabled={disabled}
							onClick={() => setEditing(false)}
						>
							Cancel edit
						</Button>
					</div>
				</div>
			) : (
				<>
					<details>
						<summary className="flashcard-details-label cursor-pointer text-sm font-medium">
							Lesson evidence
						</summary>
						<ul className="mt-3 space-y-3">
							{card.evidence.map((evidence) => (
								<li key={evidence.cueId} className="text-sm">
									<span className="flashcard-details-label">
										{timestamp(evidence.start)}–{timestamp(evidence.end)}
									</span>
									<blockquote className="flashcard-details-note mt-1 whitespace-pre-wrap">
										{evidence.quote}
									</blockquote>
								</li>
							))}
						</ul>
					</details>
					<div className="flex flex-wrap gap-2">
						<Button
							variant="ghost"
							size="sm"
							className="flashcard-floating"
							disabled={disabled}
							onClick={() => {
								setDraft({
									question: card.question,
									answer: card.answer,
									extraContext: card.extraContext ?? "",
								});
								setDeleting(false);
								setEditing(true);
							}}
						>
							Edit card
						</Button>
						<Button
							variant="ghost"
							size="sm"
							className="flashcard-floating"
							disabled={disabled}
							onClick={() => setDeleting(true)}
						>
							Delete card
						</Button>
					</div>
					{deleting && (
						<div className="space-y-3">
							<p>Delete this card? This cannot be undone.</p>
							<div className="flex flex-wrap gap-2">
								<Button
									className="flashcard-floating"
									disabled={disabled}
									onClick={() => void write(true)}
								>
									Delete
								</Button>
								<Button
									className="flashcard-floating"
									disabled={disabled}
									onClick={() => setDeleting(false)}
								>
									Keep card
								</Button>
							</div>
						</div>
					)}
				</>
			)}
			{error && (
				<p role="alert" className="text-sm">
					{error}
				</p>
			)}
		</section>
	);
}
