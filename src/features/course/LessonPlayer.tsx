import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { registerProgressFlush } from "@/features/course/closeProgress";
import { NextLessonCountdown } from "@/features/course/NextLessonCountdown";
import { trackPlayback } from "@/features/course/playbackTracking";
import { firstPlay, playQuietly } from "@/features/course/progressActions";
import { positionLabel } from "@/features/course/trackingRules";
import { useAutoAdvance } from "@/features/course/useAutoAdvance";
import { registerManagedPlayer } from "@/features/course-management/state";
import type { OutlineLesson } from "@/lib/db/courseOutline";
import { get, savePosition } from "@/lib/db/progress";
import { waitForProgressWrites } from "@/lib/db/progressWrites";
import { getLessonUrl, playbackErrorMessage } from "@/lib/playback";

export function LessonPlayer({
	courseId,
	lesson,
	autoplay,
	onComplete,
	expanded,
	bindPlayer,
	onBeforePause,
	nextLesson,
	onAdvance,
	advanceBlocked,
	bindAutoAdvance,
}: {
	courseId: number;
	lesson: OutlineLesson;
	autoplay: boolean;
	onComplete: () => Promise<void>;
	expanded: boolean;
	bindPlayer: (
		video: HTMLVideoElement,
		tracking: ReturnType<typeof trackPlayback>,
	) => () => void;
	onBeforePause: () => Promise<void>;
	nextLesson: OutlineLesson | null;
	onAdvance: () => void;
	advanceBlocked: boolean;
	bindAutoAdvance: (cancel: () => boolean) => () => void;
}) {
	const [source, setSource] = useState<string | null>(null);
	const [savedPosition, setSavedPosition] = useState(0);
	const [resumed, setResumed] = useState<number | null>(null);
	const videoRef = useRef<HTMLVideoElement>(null);
	const tracking = useRef<ReturnType<typeof trackPlayback> | null>(null);
	const completeRef = useRef(onComplete);
	const [error, setError] = useState<string | null>(null);
	const [watchError, setWatchError] = useState<string | null>(null);
	const autoplayOnce = useRef(autoplay);
	const recordPlay = useRef(firstPlay(lesson.id));
	const mounted = useRef(true);
	const autoAdvance = useAutoAdvance({
		video: videoRef,
		source,
		nextId: nextLesson?.id ?? null,
		blocked: advanceBlocked,
		advance: onAdvance,
		exitFullscreen: onBeforePause,
		bindCancel: bindAutoAdvance,
	});
	useEffect(() => {
		let active = true;
		mounted.current = true;
		void Promise.all([
			getLessonUrl(courseId, lesson.relative_path),
			waitForProgressWrites().then(() => get(lesson.id)),
		])
			.then(([url, progress]) => {
				if (active) {
					setSavedPosition(progress?.last_position_seconds ?? 0);
					setSource(url);
				}
			})
			.catch((cause: unknown) => {
				if (active) setError(playbackErrorMessage(cause));
			});
		return () => {
			active = false;
			mounted.current = false;
		};
	}, [courseId, lesson.relative_path, lesson.id]);
	useLayoutEffect(() => {
		completeRef.current = onComplete;
		tracking.current?.updateCompleted(lesson.completed);
	}, [onComplete, lesson.completed]);
	// Layout cleanup captures the still-mounted video, before route removal resets it.
	// biome-ignore lint/correctness/useExhaustiveDependencies: Completion is updated independently above; only a new source starts a visit.
	useLayoutEffect(() => {
		const video = videoRef.current;
		if (!source || !video) return;
		const controller = trackPlayback(video, {
			savedPosition,
			completed: lesson.completed,
			save: (seconds) => savePosition(lesson.id, seconds),
			complete: () => completeRef.current(),
			onResume: setResumed,
			onReady: () => {
				if (autoplayOnce.current) {
					autoplayOnce.current = false;
					void playQuietly(video);
				}
			},
			onError: () =>
				setWatchError("Could not save playback progress. Please try again."),
		});
		tracking.current = controller;
		const unbind = bindPlayer(video, controller);
		const unregister = registerProgressFlush(controller.flush);
		const unregisterPlayer = registerManagedPlayer(courseId, () => {
			void onBeforePause();
			video.pause();
		});
		const hidden = () => {
			if (document.hidden) controller.flush();
		};
		document.addEventListener("visibilitychange", hidden);
		return () => {
			controller.dispose();
			tracking.current = null;
			unbind();
			unregister();
			unregisterPlayer();
			document.removeEventListener("visibilitychange", hidden);
		};
	}, [source, savedPosition, lesson.id, courseId, bindPlayer, onBeforePause]);
	return (
		<div className={expanded ? "h-full w-full" : undefined}>
			{source ? (
				<>
					<div className={expanded ? "relative h-full w-full" : "relative"}>
						{/* biome-ignore lint/a11y/useMediaCaption: Local lesson player uses native controls; captions are out of scope. */}
						<video
							ref={videoRef}
							key={lesson.id}
							controls
							preload="metadata"
							src={source}
							aria-label={lesson.title}
							className={
								expanded
									? "h-full w-full bg-player object-contain"
									: "block aspect-video w-full rounded-lg bg-player"
							}
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
						{autoAdvance.state && nextLesson && (
							<NextLessonCountdown
								state={autoAdvance.state}
								title={nextLesson.title}
								onCancel={autoAdvance.cancel}
							/>
						)}
					</div>
					{autoAdvance.error && (
						<p role="alert" className="mt-3 text-sm text-destructive">
							{autoAdvance.error}
						</p>
					)}
					{resumed !== null && !expanded && (
						<p className="mt-2 text-sm text-muted-foreground">
							Resumed from {positionLabel(resumed)}{" "}
							<button
								type="button"
								className="ml-2 text-brand hover:underline"
								onClick={() => tracking.current?.startOver()}
							>
								Start over
							</button>
						</p>
					)}
					{error && (
						<p
							role="alert"
							className={
								expanded
									? "absolute bottom-20 left-4 rounded bg-card p-2 text-sm text-destructive"
									: "mt-3 text-sm text-destructive"
							}
						>
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
