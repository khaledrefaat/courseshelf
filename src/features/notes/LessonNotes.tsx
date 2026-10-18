import { useRef } from "react";
import { NOTE_LIMIT, pasteNote } from "@/features/notes/model";
import { useNotesSnapshot } from "@/features/notes/useNotes";

export function LessonNotes({ lessonId }: { lessonId: number }) {
	const controller = useNotesSnapshot();
	const draft = controller.get(lessonId);
	const ref = useRef<HTMLTextAreaElement>(null);
	if (!draft) return null;
	return (
		<div>
			<textarea
				ref={ref}
				dir="auto"
				aria-label="Lesson notes"
				aria-describedby={draft.limitReached ? "notes-limit" : undefined}
				placeholder="Write notes for this lesson..."
				value={draft.content}
				maxLength={NOTE_LIMIT}
				className="min-h-38 w-full resize-y rounded-xl border bg-muted px-4 py-3.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-background"
				onChange={(event) =>
					controller.edit(lessonId, event.currentTarget.value)
				}
				onCompositionStart={() => controller.composition(lessonId, true)}
				onCompositionEnd={(event) => {
					controller.edit(lessonId, event.currentTarget.value);
					controller.composition(lessonId, false);
				}}
				onBlur={() => {
					controller.composition(lessonId, false);
					void controller.flush(lessonId);
				}}
				onKeyDown={(event) => {
					event.stopPropagation();
					if (
						(event.ctrlKey || event.metaKey) &&
						event.key.toLowerCase() === "s"
					) {
						event.preventDefault();
						void controller.flush(lessonId);
					}
				}}
				onKeyUp={(event) => event.stopPropagation()}
				onPaste={(event) => {
					const element = event.currentTarget;
					const result = pasteNote(
						element.value,
						element.selectionStart,
						element.selectionEnd,
						event.clipboardData.getData("text/plain"),
					);
					if (!result.limited) return; // Let the browser preserve selection and IME normally.
					event.preventDefault();
					controller.edit(lessonId, result.text, true);
					requestAnimationFrame(() => {
						if (ref.current === element)
							element.setSelectionRange(result.cursor, result.cursor);
					});
				}}
			/>
			<div className="mt-1 flex justify-between gap-3 text-xs text-muted-foreground">
				<span id="notes-limit" role={draft.limitReached ? "status" : undefined}>
					{draft.limitReached ? "Limit reached" : ""}
				</span>
				{draft.content.length >= 45_000 && (
					<span>{draft.content.length.toLocaleString()} / 50,000</span>
				)}
			</div>
		</div>
	);
}
