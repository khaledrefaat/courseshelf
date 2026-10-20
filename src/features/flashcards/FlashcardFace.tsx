import { useId, useLayoutEffect, useRef, useState } from "react";
import {
	createFlashcardFlip,
	type FlipPhase,
} from "@/features/flashcards/flip";
import type { SavedCard } from "@/lib/db/flashcards";
import "./flashcard.css";

export function FlashcardFace({
	card,
	revealed,
	onFlip,
	disabled = false,
}: {
	card: SavedCard;
	revealed: boolean;
	onFlip(): void;
	disabled?: boolean;
}) {
	const id = useId();
	const button = useRef<HTMLButtonElement>(null);
	const latest = useRef(onFlip);
	const controller = useRef<ReturnType<typeof createFlashcardFlip> | null>(
		null,
	);
	const [phase, setPhase] = useState<FlipPhase>("idle");
	useLayoutEffect(() => {
		latest.current = onFlip;
	});
	useLayoutEffect(() => {
		const flip = createFlashcardFlip({
			reducedMotion: () =>
				button.current?.ownerDocument.defaultView?.matchMedia(
					"(prefers-reduced-motion: reduce)",
				).matches ?? true,
			changed: setPhase,
			flip: () => latest.current(),
		});
		controller.current = flip;
		return () => {
			flip.dispose();
			if (controller.current === flip) controller.current = null;
		};
	}, []);
	return (
		<button
			ref={button}
			type="button"
			className="flashcard-face"
			data-phase={phase}
			data-revealed={revealed}
			disabled={disabled}
			onClick={() => controller.current?.request()}
			aria-label={revealed ? "Show question" : "Reveal answer"}
			aria-describedby={id}
		>
			<span
				key={revealed ? "answer" : "question"}
				id={id}
				className="flashcard-body"
			>
				{revealed ? (
					<>
						<span className="block">{card.answer}</span>
						{card.extraContext && (
							<span className="flashcard-context">
								<span className="flashcard-context-label">
									AI-added context · Not independently verified
								</span>
								<span className="block">{card.extraContext}</span>
							</span>
						)}
					</>
				) : (
					card.question
				)}
			</span>
		</button>
	);
}
