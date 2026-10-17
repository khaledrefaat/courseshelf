import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { sectionLabel, sectionName } from "@/features/course/outline";
import type { Draft } from "@/features/notes/controller";
import { useNotesSnapshot } from "@/features/notes/useNotes";

function NoteEntry({ draft, courseId }: { draft: Draft; courseId: number }) {
	const [expanded, setExpanded] = useState(false);
	const controller = useNotesSnapshot();
	const navigate = useNavigate();
	const label = `${sectionLabel(sectionName(draft.lesson.relative_path))} · ${draft.lesson.title}`;
	const url = `/course/${courseId}/lesson/${draft.lesson.id}`;
	const long =
		draft.content.length > 600 || draft.content.split("\n").length > 5;
	return (
		<article dir="auto" className="rounded-xl border bg-muted p-4">
			<Link
				to={url}
				className="block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
				onClick={(event) => {
					event.preventDefault();
					void controller.flushCourse(courseId).then((saved) => {
						if (saved) navigate(url);
					});
				}}
			>
				<h3 className="mb-2 text-sm font-medium text-brand">{label}</h3>
				<p
					dir="auto"
					className={`whitespace-pre-wrap break-words text-sm leading-relaxed ${long && !expanded ? "line-clamp-5" : ""}`}
				>
					{draft.content}
				</p>
				<p className="mt-3 text-xs text-muted-foreground">
					{draft.updatedAt ? (
						<time dateTime={`${draft.updatedAt.replace(" ", "T")}Z`}>
							{new Date(
								`${draft.updatedAt.replace(" ", "T")}Z`,
							).toLocaleString()}
						</time>
					) : (
						"Not saved yet"
					)}
				</p>
			</Link>
			{long && (
				<button
					type="button"
					className="mt-2 text-sm text-brand hover:underline"
					aria-expanded={expanded}
					onClick={() => setExpanded(!expanded)}
				>
					{expanded ? "Show less" : "Show more"}
				</button>
			)}
		</article>
	);
}
export function AllNotes({ courseId }: { courseId: number }) {
	const controller = useNotesSnapshot();
	const entries = controller.entries(courseId);
	return entries.length ? (
		<div className="space-y-3">
			{entries.map((draft) => (
				<NoteEntry key={draft.lesson.id} draft={draft} courseId={courseId} />
			))}
		</div>
	) : (
		<p className="py-8 text-center text-sm text-muted-foreground">
			No notes yet. Notes you write while watching appear here.
		</p>
	);
}
