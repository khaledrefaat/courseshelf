import {
	type RefObject,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	loadSubtitle,
	populateSubtitleTrack,
	positionSubtitleCue,
	readSubtitlePreference,
	type SubtitleCue,
	writeSubtitlePreference,
} from "@/features/course/subtitleCues";
import {
	loadLessonSubtitle,
	useSubtitleRevision,
} from "@/features/course/subtitleGeneration";

export function useSubtitles(
	courseId: number,
	lessonId: number,
	relativePath: string,
	source: string | null,
	videoRef: RefObject<HTMLVideoElement | null>,
) {
	const revision = useSubtitleRevision(lessonId);
	const [loading, setLoading] = useState(true);
	const nativeTrack = useRef<{
		video: HTMLVideoElement;
		track: TextTrack;
	} | null>(null);
	const [enabled, setEnabled] = useState(() =>
		readSubtitlePreference(localStorage),
	);
	const enabledRef = useRef(enabled);
	const trackReady = useRef(false);
	const [subtitle, setSubtitle] = useState<{
		key: string;
		filename: string;
		cues: SubtitleCue[];
	} | null>(null);
	const [failure, setFailure] = useState<{
		key: string;
		message: string;
	} | null>(null);
	const [installed, setInstalled] = useState(false);
	const key = `${courseId}:${relativePath}`;
	useEffect(() => {
		void revision;
		if (!source) return;
		setLoading(true);
		setSubtitle(null);
		setFailure(null);
		return loadSubtitle(
			() => loadLessonSubtitle(courseId, lessonId, relativePath),
			(result) => {
				setSubtitle(result ? { key, ...result } : null);
				setLoading(false);
			},
			(message) => {
				setFailure({ key, message });
				setLoading(false);
			},
		);
	}, [courseId, lessonId, relativePath, source, key, revision]);
	useLayoutEffect(() => {
		trackReady.current = false;
		setInstalled(false);
		const video = videoRef.current;
		if (!source || !video || subtitle?.key !== key) return;
		try {
			if (nativeTrack.current?.video !== video) {
				nativeTrack.current = {
					video,
					track: video.addTextTrack("captions", "Subtitles", "en"),
				};
			}
			const track = nativeTrack.current.track;
			const clear = populateSubtitleTrack(
				track,
				subtitle.cues,
				(start, end, text) => positionSubtitleCue(new VTTCue(start, end, text)),
			);
			track.mode = enabledRef.current ? "showing" : "disabled";
			trackReady.current = true;
			setInstalled(true);
			return () => {
				// Cleanup's mode change must not become the user's saved preference.
				trackReady.current = false;
				clear();
			};
		} catch {
			setFailure({
				key,
				message: "This webview could not display the subtitles.",
			});
		}
	}, [subtitle, key, source, videoRef]);
	useEffect(() => {
		const current = nativeTrack.current;
		if (!installed || !current) return;
		const { video, track } = current;
		const changed = () => {
			if (!trackReady.current) return;
			const value = track.mode === "showing";
			enabledRef.current = value;
			setEnabled(value);
			writeSubtitlePreference(localStorage, value);
		};
		video.textTracks.addEventListener("change", changed);
		return () => video.textTracks.removeEventListener("change", changed);
	}, [installed]);
	return {
		loading,
		available: installed && subtitle?.key === key && failure?.key !== key,
		enabled,
		filename: subtitle?.key === key ? subtitle.filename : undefined,
		error: failure?.key === key ? failure.message : null,
		toggle() {
			const value = !enabledRef.current;
			enabledRef.current = value;
			setEnabled(value);
			writeSubtitlePreference(localStorage, value);
			if (nativeTrack.current)
				nativeTrack.current.track.mode = value ? "showing" : "disabled";
		},
	};
}
