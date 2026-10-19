import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
	courseSubtitles,
	useCourseSubtitles,
} from "@/features/course/courseSubtitles";
import { subtitleDownloads } from "@/features/course/subtitleDownloads";
import {
	cancelGeneration,
	useSubtitleGeneration,
} from "@/features/course/subtitleGeneration";
import type { Course } from "@/lib/db/courses";

export function CourseSubtitlesDialog({
	course,
	onClose,
}: {
	course: Course;
	onClose(): void;
}) {
	const [saveBeside, setSaveBeside] = useState(true);
	const [consent, setConsent] = useState(false);
	const [error, setError] = useState("");
	const queue = useCourseSubtitles();
	const { status } = useSubtitleGeneration();
	const active =
		queue?.running || status?.job?.running || !!status?.job?.result;
	const downloads = subtitleDownloads(status);
	const needsConsent = downloads.length > 0;
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Generate course subtitles</DialogTitle>
					<DialogDescription>
						Generate English subtitles for “{course.title}”, one lesson at a
						time. Existing subtitles are kept, and valid generated subtitles are
						reused.
					</DialogDescription>
				</DialogHeader>
				<label className="flex items-start gap-2">
					<input
						className="mt-0.5 accent-brand"
						type="checkbox"
						checked={saveBeside}
						onChange={(event) => setSaveBeside(event.target.checked)}
					/>
					Save subtitles beside videos (.en.vtt)
				</label>
				<p className="text-sm text-muted-foreground">
					This creates files in the course folder. Nothing is overwritten.
					Courseshelf also keeps its own copy. Read-only or unsupported folders
					are reported without losing generated subtitles.
				</p>
				{needsConsent && (
					<label className="flex items-start gap-2">
						<input
							className="mt-0.5 accent-brand"
							type="checkbox"
							checked={consent}
							onChange={(event) => setConsent(event.target.checked)}
						/>
						Allow downloading {downloads.join(" and ")}. Saved in app data for
						offline reuse. Also allow repairing FFmpeg or the English model if a
						cached copy fails verification. Audio stays on this computer.
					</label>
				)}
				{error && (
					<p role="alert" className="text-destructive">
						{error}
					</p>
				)}
				{active && (
					<p className="text-muted-foreground">
						Another subtitle job is running. Cancel it or wait.
					</p>
				)}
				<div className="flex justify-end gap-2">
					<Button variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button
						disabled={
							!!active || !status?.helpersPresent || (needsConsent && !consent)
						}
						onClick={() => {
							void courseSubtitles
								.start(course.id, course.title, saveBeside, consent)
								.catch((cause) => setError(String(cause)));
							// start() reserves and publishes synchronously, so an accepted queue is visible now.
							if (courseSubtitles.getSnapshot()?.running) onClose();
						}}
					>
						Generate subtitles
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

export function CourseSubtitlesStatus() {
	const queue = useCourseSubtitles();
	const { status } = useSubtitleGeneration();
	const [error, setError] = useState("");
	const [showIssues, setShowIssues] = useState(false);
	if (!queue) return null;
	const percent = queue.total ? (queue.processed / queue.total) * 100 : 0;
	return (
		<div className="shrink-0 border-b bg-card px-5 py-2 text-sm">
			<div className="flex flex-wrap items-center gap-3">
				<p role="status" className="min-w-0 flex-1 truncate">
					{queue.title}:{" "}
					{queue.running
						? `Lesson ${Math.min(queue.processed + 1, queue.total) || 1} of ${queue.total || "…"} · ${queue.current}`
						: queue.cancelled
							? "Subtitle queue cancelled"
							: "Subtitle queue finished"}
				</p>
				{queue.running ? (
					<Button
						size="sm"
						variant="outline"
						disabled={queue.cancelled}
						onClick={() => {
							setError("");
							void cancelGeneration(queue.courseId).catch((cause) =>
								setError(String(cause)),
							);
						}}
					>
						{queue.cancelled ? "Cancelling…" : "Cancel"}
					</Button>
				) : (
					<Button
						size="sm"
						variant="ghost"
						onClick={() => courseSubtitles.dismiss()}
					>
						Dismiss
					</Button>
				)}
			</div>
			{queue.running && (
				<>
					<Progress value={percent} className="mt-2 h-1" />
					<p className="mt-1 text-muted-foreground">
						{status?.job?.courseId === queue.courseId
							? `${status.job.stage}${status.job.progress === null ? "" : ` · ${status.job.progress}%`}`
							: "Checking subtitles…"}
					</p>
				</>
			)}
			<p className="mt-1 text-muted-foreground">
				{queue.generated} generated · {queue.reused} reused · {queue.skipped}{" "}
				skipped · {queue.failed} failed · {queue.exported} saved beside videos ·{" "}
				{queue.exportFailed} export failures
			</p>
			{!!queue.errors.length && (
				<div className="mt-1">
					<Button
						variant="ghost"
						size="sm"
						aria-expanded={showIssues}
						onClick={() => setShowIssues(!showIssues)}
					>
						{showIssues ? "Hide" : "Show"} issues ({queue.errors.length})
					</Button>
					{showIssues && (
						<ul className="max-h-36 overflow-auto text-destructive">
							{[...new Set(queue.errors)].map((issue) => (
								<li key={issue}>{issue}</li>
							))}
						</ul>
					)}
				</div>
			)}
			{error && (
				<p role="alert" className="text-destructive">
					{error}
				</p>
			)}
		</div>
	);
}
