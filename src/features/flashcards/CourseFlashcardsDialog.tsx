import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import type { CoursePlan } from "@/features/flashcards/courseQueue";
import { FlashcardKeyDialog } from "@/features/flashcards/FlashcardKeyDialog";
import {
	courseFlashcards,
	sessionKey,
	useCourseFlashcards,
	useFlashcards,
} from "@/features/flashcards/service";
import type { Course } from "@/lib/db/courses";

export function CourseFlashcardsDialog({
	course,
	onClose,
}: {
	course: Course;
	onClose(): void;
}) {
	const [plan, setPlan] = useState<CoursePlan | null>(null);
	const [progress, setProgress] = useState("Checking lessons…");
	const [error, setError] = useState("");
	const [consent, setConsent] = useState(false);
	const [keyOpen, setKeyOpen] = useState(false);
	const [revision, setRevision] = useState(0);
	const state = useFlashcards(),
		queue = useCourseFlashcards();
	const active = !!state.job?.running || !!queue?.running;
	useEffect(() => {
		void revision;
		const abort = new AbortController();
		setPlan(null);
		setConsent(false);
		setError("");
		setProgress("Checking lessons…");
		void courseFlashcards
			.prepare(course.id, course.title, abort.signal, (done, total) => {
				if (!abort.signal.aborted)
					setProgress(`Checking lesson ${done} of ${total}…`);
			})
			.then((result) => {
				if (!abort.signal.aborted) {
					setPlan(result);
					setProgress("");
				}
			})
			.catch((cause) => {
				if (!abort.signal.aborted) {
					setError(String(cause));
					setProgress("");
				}
			});
		void sessionKey().catch(() => {});
		return () => abort.abort();
	}, [course.id, course.title, revision]);
	const eligible = plan?.items.filter((item) => item.status === "ready") ?? [];
	return (
		<>
			<Dialog
				open
				onOpenChange={(open) => {
					if (!open) onClose();
				}}
			>
				<DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>Generate course flashcards</DialogTitle>
						<DialogDescription>
							Prepare “{course.title}” one lesson at a time. Saved sets, edits
							and zero-card results are kept. Only missing sets are generated.
						</DialogDescription>
					</DialogHeader>
					{progress && (
						<p role="status">
							{progress} No API requests are sent during preview.
						</p>
					)}
					{plan && (
						<>
							<p>
								{eligible.length} ready ·{" "}
								{plan.items.filter((item) => item.status === "saved").length}{" "}
								already processed ·{" "}
								{plan.items.filter((item) => item.status === "issue").length}{" "}
								need attention
							</p>
							<p>
								At most <strong>{plan.maximumRequests} new API requests</strong>
								; {eligible.reduce((n, item) => n + item.reused, 0)} received
								responses reused. Each request is capped at 8,192 output tokens;
								actual input usage varies. This is not a price or
								package-billing estimate.
							</p>
							<details className="text-sm text-muted-foreground">
								<summary className="cursor-pointer">Lesson preview</summary>
								<ul className="mt-2 max-h-48 space-y-2 overflow-y-auto">
									{plan.items.map((item) => (
										<li key={item.id} className="break-words">
											<span className="font-medium">{item.title}</span>:{" "}
											{item.status === "ready"
												? `up to ${item.requests} new requests · ${item.reused} reused`
												: item.reason}
										</li>
									))}
								</ul>
							</details>
							<p className="text-sm text-muted-foreground">
								Uses matching VTT/SRT subtitles or valid generated caches.
								Missing/invalid transcripts and checkpoints needing attention
								are skipped—run course subtitles first if needed. No automatic
								transcription, start-over or API retries.
							</p>
							<label className="flex items-start gap-2 text-sm">
								<input
									className="mt-0.5 accent-brand"
									type="checkbox"
									checked={consent}
									onChange={(event) => setConsent(event.target.checked)}
								/>
								I allow uploading these eligible lessons’ transcript text to
								Z.ai using my credits, and reusing compatible received work. No
								video, notes or course-folder paths are sent. Transcript text
								itself may contain personal information. Cards can be wrong;
								AI-added context is not independently verified.
							</label>
						</>
					)}
					<div className="flex flex-wrap gap-2">
						<Button
							variant="ghost"
							onClick={() => setKeyOpen(true)}
							disabled={active}
						>
							{state.keyReady ? "Replace session API key" : "Enter API key"}
						</Button>
						{state.keyReady && (
							<Button
								variant="ghost"
								onClick={() => {
									void sessionKey("")
										.then(() => setRevision((n) => n + 1))
										.catch((cause) => setError(String(cause)));
								}}
							>
								Forget key
							</Button>
						)}
					</div>
					{active && (
						<p className="text-sm text-muted-foreground">
							Another flashcard job is running. Wait or cancel it in the status
							bar.
						</p>
					)}
					{error && (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}
					<div className="flex flex-wrap justify-end gap-2">
						<Button
							variant="ghost"
							disabled={!!progress}
							onClick={() => setRevision((n) => n + 1)}
						>
							Refresh preview
						</Button>
						<Button variant="outline" onClick={onClose}>
							Cancel
						</Button>
						<Button
							disabled={
								!plan ||
								!eligible.length ||
								!consent ||
								active ||
								(plan.maximumRequests > 0 && !state.keyReady)
							}
							onClick={() => {
								if (!plan) return;
								void courseFlashcards
									.start(plan)
									.catch((cause) => setError(String(cause)));
								if (courseFlashcards.getSnapshot()?.running) onClose();
							}}
						>
							Generate missing flashcards
						</Button>
					</div>
				</DialogContent>
			</Dialog>
			{keyOpen && <FlashcardKeyDialog onClose={() => setKeyOpen(false)} />}
		</>
	);
}
