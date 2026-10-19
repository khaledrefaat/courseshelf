export interface SubtitleCue {
	start: number;
	end: number;
	text: string;
}

function timestamp(value: string): number {
	const match = /^(?:(\d{2,}):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(value);
	if (!match || Number(match[2]) >= 60 || Number(match[3]) >= 60)
		throw new Error("Subtitle contains an invalid timestamp.");
	const seconds =
		Number(match[1] ?? 0) * 3600 +
		Number(match[2]) * 60 +
		Number(match[3]) +
		Number(match[4]) / 1000;
	if (!Number.isFinite(seconds))
		throw new Error("Subtitle contains an invalid timestamp.");
	return seconds;
}

// Basic timed-text cues only: VTT stylesheet/region blocks are not applied.
// Text is passed to VTTCue, never inserted as HTML into the application DOM.
export function parseSubtitle(content: string): SubtitleCue[] {
	const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
	const cues: SubtitleCue[] = [];
	for (const block of normalized.split(/\n[\t ]*\n/)) {
		const lines = block.split("\n");
		if (/^(WEBVTT(?:[\t ]|$)|NOTE(?:[\t ]|$)|STYLE$|REGION$)/.test(lines[0]))
			continue;
		const index = lines.findIndex((line) => line.includes("-->"));
		if (index < 0) continue;
		const match = /^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/.exec(lines[index].trim());
		if (!match) throw new Error("Subtitle contains an invalid cue.");
		const start = timestamp(match[1]);
		const end = timestamp(match[2]);
		if (end <= start) throw new Error("Subtitle cue ends before it starts.");
		const text = lines.slice(index + 1).join("\n");
		if (text.trim()) cues.push({ start, end, text });
		if (cues.length > 10_000)
			throw new Error("Subtitle exceeds the 10,000 cue limit.");
	}
	if (!cues.length) throw new Error("Subtitle contains no readable cues.");
	return cues;
}

export const SUBTITLE_PREFERENCE = "courseshelf:subtitles-enabled";
export function readSubtitlePreference(
	storage: Pick<Storage, "getItem">,
): boolean {
	try {
		return storage.getItem(SUBTITLE_PREFERENCE) !== "false";
	} catch {
		return true;
	}
}

export function writeSubtitlePreference(
	storage: Pick<Storage, "setItem">,
	enabled: boolean,
): void {
	try {
		storage.setItem(SUBTITLE_PREFERENCE, String(enabled));
	} catch {
		/* Storage can be unavailable; toggling still works for this visit. */
	}
}

export function subtitlePlatform(
	userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
): "windows" | "native" {
	// WebView2 identifies Windows here; do not apply its layout workaround to GTK.
	return /\bWindows\b/i.test(userAgent) ? "windows" : "native";
}

export function positionSubtitleCue<
	T extends Pick<VTTCue, "line" | "snapToLines">,
>(cue: T): T {
	// Negative line numbers count upwards from the bottom of the video.
	// Leave two extra lines of breathing room above the default bottom position.
	cue.snapToLines = true;
	cue.line = -3;
	return cue;
}

export function populateSubtitleTrack(
	track: Pick<TextTrack, "cues" | "removeCue" | "addCue" | "mode">,
	cues: readonly SubtitleCue[],
	makeCue: (start: number, end: number, text: string) => TextTrackCue,
): () => void {
	const clear = () => {
		track.mode = "hidden";
		while (track.cues?.length) track.removeCue(track.cues[0]);
		track.mode = "disabled";
	};
	// Hidden exposes the cue list without showing subtitles while installing it.
	track.mode = "hidden";
	while (track.cues?.length) track.removeCue(track.cues[0]);
	try {
		for (const cue of cues) track.addCue(makeCue(cue.start, cue.end, cue.text));
	} catch (error) {
		clear();
		throw error;
	}
	return clear;
}

export interface SubtitleSidecar {
	filename: string;
	content: string;
}
export interface ParsedSubtitle {
	filename: string;
	cues: SubtitleCue[];
}

// Each request owns its cancellation flag: late results and errors from a
// previous lesson must never install cues or replace the current lesson's UI.
export function loadSubtitle(
	read: () => Promise<SubtitleSidecar | null>,
	loaded: (result: ParsedSubtitle | null) => void,
	failed: (message: string) => void,
): () => void {
	let active = true;
	void Promise.resolve()
		.then(read)
		.then((result) => {
			if (active)
				loaded(
					result
						? { filename: result.filename, cues: parseSubtitle(result.content) }
						: null,
				);
		})
		.catch((error: unknown) => {
			if (active)
				failed(
					error instanceof Error
						? error.message
						: typeof error === "string"
							? error
							: "Could not load subtitles.",
				);
		});
	return () => {
		active = false;
	};
}
