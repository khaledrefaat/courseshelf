import { Link } from "react-router";
import { useNotesSnapshot } from "@/features/notes/useNotes";

export function NotesWarnings() {
	const controller = useNotesSnapshot();
	const failures = controller.failures();
	if (!failures.length) return null;
	return (
		<div
			role="alert"
			className="shrink-0 border-b bg-card px-5 py-2 text-sm text-destructive"
		>
			{failures.map((draft) => (
				<p key={draft.lesson.id}>
					Unsaved notes for{" "}
					<Link
						className="underline"
						to={`/course/${draft.courseId}/lesson/${draft.lesson.id}`}
					>
						{draft.lesson.title}
					</Link>
					. Your text is kept in memory.{" "}
					<button
						type="button"
						className="underline"
						onClick={() => void controller.flush(draft.lesson.id)}
					>
						Retry
					</button>
				</p>
			))}
		</div>
	);
}
