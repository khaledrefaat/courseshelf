import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CourseScanTest } from "@/features/course/CourseScanTest";
import "@/App.css";

const positionKey = (path: string) => `courseshelf:video-spike:${path}`;

function App() {
	const videoRef = useRef<HTMLVideoElement>(null);
	const [path, setPath] = useState<string | null>(null);
	const [videoUrl, setVideoUrl] = useState<string>();
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState<number | null>(null);
	const [choosing, setChoosing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState("");

	async function chooseVideo() {
		setChoosing(true);
		try {
			const selected = await open({
				multiple: false,
				directory: false,
				filters: [{ name: "MP4 video", extensions: ["mp4"] }],
			});
			if (!selected) return;
			const url = await invoke<string>("select_video", { path: selected });
			setCurrentTime(0);
			setDuration(null);
			setError(null);
			setStatus("");
			setPath(selected);
			setVideoUrl(url);
		} catch (cause) {
			setError(`Could not choose/load video: ${String(cause)}`);
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
			setError(`Could not resume: ${String(cause)}`);
		}
	}

	return (
		<main>
			<h1>Video playback spike</h1>
			{import.meta.env.DEV && <CourseScanTest />}
			<Button onClick={chooseVideo} disabled={choosing}>
				Choose video
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

export default App;
