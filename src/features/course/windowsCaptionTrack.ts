type CaptionCue = Pick<VTTCue, "getCueAsHTML">;

export function activeCaptionText(
	cues: ArrayLike<TextTrackCue> | null,
): string {
	return Array.from(cues ?? [])
		.filter(
			(cue): cue is TextTrackCue & CaptionCue =>
				"getCueAsHTML" in cue && typeof cue.getCueAsHTML === "function",
		)
		.map((cue) => cue.getCueAsHTML().textContent ?? "")
		.filter(Boolean)
		.join("\n");
}

// Hidden tracks still maintain activeCues and cuechange, but never paint native
// captions. React renders only textContent, not subtitle HTML or VTT styles.
export function bindWindowsSubtitles(
	video: Pick<
		HTMLVideoElement,
		| "addEventListener"
		| "removeEventListener"
		| "seeking"
		| "ended"
		| "error"
		| "readyState"
	>,
	track: Pick<
		TextTrack,
		"mode" | "activeCues" | "addEventListener" | "removeEventListener"
	>,
	tracks: Pick<TextTrackList, "addEventListener" | "removeEventListener">,
	initiallyEnabled: boolean,
	onText: (text: string) => void,
	onEnabled: (enabled: boolean) => void,
) {
	let enabled = initiallyEnabled;
	let disposed = false;
	const clear = () => onText("");
	const sync = () => {
		if (disposed) return;
		onText(
			enabled &&
				video.readyState >= 1 &&
				!video.seeking &&
				!video.ended &&
				!video.error
				? activeCaptionText(track.activeCues)
				: "",
		);
	};
	const apply = () => {
		const mode = enabled ? "hidden" : "disabled";
		if (track.mode !== mode) track.mode = mode;
		sync();
	};
	const changed = () => {
		if (disposed) return;
		// Honor a native CC action without allowing a second, native caption layer.
		const next = track.mode !== "disabled";
		if (next !== enabled) {
			enabled = next;
			onEnabled(next);
		}
		apply();
	};
	const updates = [
		"timeupdate",
		"seeked",
		"loadedmetadata",
		"playing",
		"pause",
	];
	const clears = ["seeking", "ended", "error", "emptied"];
	track.addEventListener("cuechange", sync);
	tracks.addEventListener("change", changed);
	for (const event of updates) video.addEventListener(event, sync);
	for (const event of clears) video.addEventListener(event, clear);
	apply();
	return {
		setEnabled(value: boolean) {
			if (disposed) return;
			enabled = value;
			apply();
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			track.removeEventListener("cuechange", sync);
			tracks.removeEventListener("change", changed);
			for (const event of updates) video.removeEventListener(event, sync);
			for (const event of clears) video.removeEventListener(event, clear);
			track.mode = "disabled";
			clear();
		},
	};
}
