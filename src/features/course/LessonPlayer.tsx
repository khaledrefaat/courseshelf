import { useEffect, useRef, useState } from "react";
import { firstPlay, playQuietly } from "@/features/course/progressActions";
import type { OutlineLesson } from "@/lib/db/courseOutline";
import { getLessonUrl, playbackErrorMessage } from "@/lib/playback";

export function LessonPlayer({
	courseId,
	lesson,
	autoplay,
}: {
	courseId: number;
	lesson: OutlineLesson;
	autoplay: boolean;
}) {
	const [source, setSource] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [watchError, setWatchError] = useState<string | null>(null);
	const autoplayOnce = useRef(autoplay);
	const recordPlay = useRef(firstPlay(lesson.id));
	const mounted = useRef(true);
	useEffect(() => {
		let active = true;
		mounted.current = true;
		void getLessonUrl(courseId, lesson.relative_path)
			.then((url) => {
				if (active) setSource(url);
			})
			.catch((cause: unknown) => {
				if (active) setError(playbackErrorMessage(cause));
			});
		return () => {
			active = false;
			mounted.current = false;
		};
	}, [courseId, lesson.relative_path]);
	return (
		<div>
			{source ? (
				<>
					{/* biome-ignore lint/a11y/useMediaCaption: Local lesson player uses native controls; captions are out of scope. */}
					<video
						key={lesson.id}
						controls
						preload="metadata"
						src={source}
						aria-label={lesson.title}
						className="aspect-video w-full rounded-lg bg-primary"
						onLoadedMetadata={(event) => {
							if (autoplayOnce.current) {
								autoplayOnce.current = false;
								void playQuietly(event.currentTarget);
							}
						}}
						onPlay={() => {
							void recordPlay.current().catch(() => {
								if (mounted.current)
									setWatchError(
										"Could not record this lesson as watched. Your saved position and completion were not changed.",
									);
							});
						}}
						onError={(event) => {
							setError(
								`Video failed to load (error code: ${event.currentTarget.error?.code ?? "unknown"}).`,
							);
						}}
					/>
					{error && (
						<p role="alert" className="mt-3 text-sm text-destructive">
							{error}
						</p>
					)}
				</>
			) : (
				<div className="flex aspect-video items-center justify-center rounded-lg border bg-card p-8 text-center text-muted-foreground">
					<p role={error ? "alert" : "status"}>{error ?? "Preparing video…"}</p>
				</div>
			)}
			{watchError && (
				<p role="alert" className="mt-3 text-sm text-destructive">
					{watchError}
				</p>
			)}
		</div>
	);
}
