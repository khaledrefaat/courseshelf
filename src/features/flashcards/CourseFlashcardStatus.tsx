import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
	cancelFlashcards,
	courseFlashcards,
	useCourseFlashcards,
	useFlashcards,
} from "@/features/flashcards/service";

export function CourseFlashcardStatus() {
	const queue = useCourseFlashcards(),
		{ job } = useFlashcards();
	const [error, setError] = useState("");
	if (!queue) return null;
	return (
		<div className="shrink-0 border-b bg-card px-5 py-2 text-sm">
			<div className="flex flex-wrap items-center gap-3">
				<p role="status" className="min-w-0 flex-1 truncate">
					{queue.title} ·{" "}
					{queue.running
						? `Lesson ${Math.min(queue.processed + 1, queue.total)} of ${queue.total} · ${queue.current}`
						: queue.cancelled
							? "Flashcard queue cancelled"
							: queue.stopped
								? "Flashcard queue stopped—see issues"
								: "Flashcard queue finished"}
				</p>
				{queue.running ? (
					<Button
						size="sm"
						variant="outline"
						disabled={queue.cancelled}
						onClick={() => {
							setError("");
							void cancelFlashcards(queue.courseId).catch(() =>
								setError("Could not cancel. Close the app to stop generation."),
							);
						}}
					>
						{queue.cancelled ? "Cancelling…" : "Cancel"}
					</Button>
				) : (
					<Button
						size="sm"
						variant="ghost"
						onClick={() => courseFlashcards.dismiss()}
					>
						Dismiss
					</Button>
				)}
			</div>
			{queue.running && (
				<>
					<Progress
						value={queue.total ? (queue.processed / queue.total) * 100 : 0}
						className="mt-2 h-1"
					/>
					<p className="mt-1 text-muted-foreground">
						{job?.running && job.courseId === queue.courseId
							? job.stage
							: "Checking saved cards and transcript…"}
					</p>
				</>
			)}
			<p className="mt-1 text-muted-foreground">
				{queue.generated} generated ({queue.resumed} resumed) · {queue.skipped}{" "}
				skipped · {queue.failed} failed · {queue.requests}/
				{queue.maximumRequests} new requests
			</p>
			<p className="text-xs text-muted-foreground">
				Reported tokens: {queue.newTokens} new · {queue.reusedTokens} reused
				{queue.unknownUsage
					? ` · ${queue.unknownUsage} request(s) with unknown usage`
					: ""}
				. Not a package-billing estimate.
			</p>
			{!!((queue.excludedTokens ?? 0) + (queue.excludedUnknownUsage ?? 0)) && (
				<p className="text-xs text-muted-foreground">
					Earlier responses excluded from recovery: {queue.excludedTokens ?? 0}{" "}
					reported tokens
					{queue.excludedUnknownUsage
						? ` · ${queue.excludedUnknownUsage} with unknown usage`
						: ""}
					. These may already have consumed credits; they are not reused or
					counted as new requests.
				</p>
			)}
			{!!queue.errors.length && (
				<details className="mt-1">
					<summary className="cursor-pointer">
						Issues ({queue.errors.length}
						{queue.errors.length === 50 ? "; latest 50" : ""})
					</summary>
					<ul className="max-h-36 overflow-y-auto text-destructive">
						{[...new Set(queue.errors)].map((issue) => (
							<li key={issue} className="break-words">
								{issue}
							</li>
						))}
					</ul>
				</details>
			)}
			{error && (
				<p role="alert" className="text-destructive">
					{error}
				</p>
			)}
		</div>
	);
}
