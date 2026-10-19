import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useCourseSubtitles } from "@/features/course/courseSubtitles";
import { subtitleDownloads } from "@/features/course/subtitleDownloads";
import {
	cancelGeneration,
	pollGeneration,
	startGeneration,
	useSubtitleGeneration,
} from "@/features/course/subtitleGeneration";
import { useManagement } from "@/features/course-management/state";

export function GenerateSubtitles({
	courseId,
	lessonId,
	relativePath,
	available,
}: {
	courseId: number;
	lessonId: number;
	relativePath: string;
	available: boolean;
}) {
	const { status, error } = useSubtitleGeneration();
	const management = useManagement();
	const queue = useCourseSubtitles();
	const [confirm, setConfirm] = useState(false);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const job = status?.job;
	const active = !!queue?.running || (!!job && (job.running || !!job.result));
	const own = job?.lessonId === lessonId && job.courseId === courseId;
	const act = async (task: () => Promise<unknown>) => {
		setBusy(true);
		setFailure(null);
		try {
			await task();
		} catch (cause) {
			setFailure(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(false);
		}
	};
	if (available && !own) return null;
	if (available && !active && !error && !failure) return null;
	const downloads = subtitleDownloads(status);
	return (
		<div className="mt-3 space-y-2 text-sm">
			{active && own && (job.running || job.result) ? (
				<div
					className="flex flex-wrap items-center gap-3 text-muted-foreground"
					role="status"
				>
					<span>
						{job.stage}
						{job.progress !== null ? ` · ${job.progress}%` : "…"}
					</span>
					{job.progress !== null && (
						<Progress value={job.progress} className="w-32" />
					)}
					<Button
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={() => {
							void act(() => cancelGeneration(courseId));
						}}
					>
						Cancel
					</Button>
				</div>
			) : (
				!available && (
					<>
						{confirm ? (
							<div className="rounded-lg border bg-card p-3">
								<p>
									Download {downloads.join(" and ")}? Saved in app data for
									offline reuse. Audio stays on your computer.
								</p>
								<p className="mt-2 text-muted-foreground">
									This also allows repairing FFmpeg or the English model if a
									cached copy fails verification.
								</p>
								<div className="mt-3 flex gap-2">
									<Button
										size="sm"
										disabled={busy || active || management.busy}
										onClick={() => {
											setConfirm(false);
											void act(() =>
												startGeneration(courseId, lessonId, relativePath, true),
											);
										}}
									>
										Download and generate
									</Button>
									<Button
										variant="outline"
										size="sm"
										onClick={() => setConfirm(false)}
									>
										Cancel
									</Button>
								</div>
							</div>
						) : (
							<Button
								variant="outline"
								size="sm"
								disabled={
									busy || active || management.busy || !status?.helpersPresent
								}
								onClick={() => {
									if (downloads.length) setConfirm(true);
									else
										void act(() =>
											startGeneration(courseId, lessonId, relativePath, false),
										);
								}}
							>
								Generate English subtitles
							</Button>
						)}
						{active && !own && (
							<p className="text-muted-foreground">
								Another lesson’s subtitles are being generated. One lesson at a
								time.
							</p>
						)}
						{status && !status.helpersPresent && (
							<p className="text-muted-foreground">
								Subtitle helpers are unavailable in this build. Developers: run
								pnpm prepare:subtitles.
							</p>
						)}
					</>
				)
			)}
			{(failure || error || (own && job?.error)) && (
				<p role="alert" className="text-destructive">
					{failure || error || job?.error}
				</p>
			)}
			{!status && (
				<Button
					variant="ghost"
					size="sm"
					disabled={busy}
					onClick={() => {
						void act(pollGeneration);
					}}
				>
					Check subtitle tools
				</Button>
			)}
		</div>
	);
}
