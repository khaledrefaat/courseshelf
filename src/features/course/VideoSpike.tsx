import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CourseScanTest } from "@/features/course/CourseScanTest";
import { readLastCourse } from "@/features/course/lastTestCourse";
import { getById } from "@/lib/db/courses";
import { listByCourse } from "@/lib/db/lessons";
import { getLessonUrl, playbackErrorMessage } from "@/lib/playback";

const positionKey = (path: string) => `courseshelf:video-spike:${path}`;

function VideoSpike() {
	const videoRef = useRef<HTMLVideoElement>(null);
	const [path, setPath] = useState<string | null>(null);
	const [videoUrl, setVideoUrl] = useState<string>();
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState<number | null>(null);
	const [choosing, setChoosing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState("");

	useEffect(() => {
		const video = videoRef.current;
		if (!videoUrl || !video) return;
		void video.play().catch((cause: unknown) => {
			if (cause instanceof DOMException && cause.name === "AbortError") return;
			setError(
				video.error
					? `Video failed to load (error code: ${video.error.code}).`
					: playbackErrorMessage(cause),
			);
		});
	}, [videoUrl]);

	async function playFirstLesson() {
		setChoosing(true);
		try {
			const courseId = readLastCourse();
			if (courseId === null)
				throw new Error("Choose and sync a course folder first.");
			const course = await getById(courseId);
			if (!course) throw new Error("The last course no longer exists.");
			const [lesson] = await listByCourse(courseId);
			if (!lesson)
				throw new Error("The course has no available lessons. Sync it first.");
			const url = await getLessonUrl(courseId, lesson.relative_path);
			if (url === videoUrl) {
				await videoRef.current?.play();
				return;
			}
			setCurrentTime(0);
			setDuration(null);
			setError(null);
			setStatus("");
			setPath(`${course.root_path.replace(/\/$/, "")}/${lesson.relative_path}`);
			setVideoUrl(url);
		} catch (cause) {
			setError(playbackErrorMessage(cause));
		} finally {
			setChoosing(false);
		}
	}

	function savePosition() {
		const video = videoRef.current;
		if (!video || !path) return;
		try {
			localStorage.setItem(positionKey(path), String(video.currentTime));
			setStatus(`Saved position: ${video.currentTime.toFixed(1)} s`);
		} catch (cause) {
			setError(`Could not save position: ${String(cause)}`);
		}
	}

	async function resume() {
		const video = videoRef.current;
		if (!video || !path || duration === null) return;
		try {
			const saved = localStorage.getItem(positionKey(path));
			if (saved === null) {
				setStatus(
					"No saved position for this file. Click Save position first.",
				);
				return;
			}
			const position = Number(saved);
			if (!Number.isFinite(position) || position < 0) {
				throw new Error("The saved position is invalid.");
			}
			video.currentTime = Math.min(position, duration);
			await video.play();
			setStatus(`Resumed from ${Math.min(position, duration).toFixed(1)} s`);
		} catch (cause) {
			setError(`Could not resume: ${playbackErrorMessage(cause)}`);
		}
	}

	return (
		<main>
			<h1>Video playback spike</h1>
			{import.meta.env.DEV && <CourseScanTest />}
			<Button onClick={playFirstLesson} disabled={choosing}>
				Play first lesson of last course
			</Button>
			{/* biome-ignore lint/a11y/useMediaCaption: Local MP4 spike; no caption file is provided. */}
			<video
				key={videoUrl}
				ref={videoRef}
				className="block max-h-96 w-full"
				controls
				preload="metadata"
				src={videoUrl}
				onTimeUpdate={(event) =>
					setCurrentTime(event.currentTarget.currentTime)
				}
				onDurationChange={(event) => {
					const value = event.currentTarget.duration;
					setDuration(Number.isFinite(value) ? value : null);
				}}
				onError={(event) => {
					const mediaError = event.currentTarget.error;
					setError(
						`Video failed to load (error code: ${mediaError?.code ?? "unknown"}). ${mediaError?.message ?? ""}`,
					);
				}}
			/>
			<p>Current time: {currentTime.toFixed(1)} s</p>
			<p>
				Duration: {duration === null ? "Unknown" : `${duration.toFixed(1)} s`}
			</p>
			<p className="break-all">File: {path ?? "No video chosen"}</p>
			<Button onClick={savePosition} disabled={duration === null}>
				Save position
			</Button>{" "}
			<Button onClick={resume} disabled={duration === null}>
				Resume
			</Button>
			<p role="status">{status}</p>
			{error && <p role="alert">{error}</p>}
		</main>
	);
}

export default VideoSpike;
