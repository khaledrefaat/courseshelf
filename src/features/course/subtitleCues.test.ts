import { describe, expect, it, vi } from "vitest";
import {
	loadSubtitle,
	parseSubtitle,
	populateSubtitleTrack,
	positionSubtitleCue,
	readSubtitlePreference,
	SUBTITLE_PREFERENCE,
	type SubtitleSidecar,
	subtitlePlatform,
	writeSubtitlePreference,
} from "@/features/course/subtitleCues";

const vtt =
	"WEBVTT\n\n00:00.000 --> 00:02.000\nHello\n\n00:02.000 --> 00:04.500\nمرحبا Hello";

it("raises native subtitles from the bottom without changing text or timing", () => {
	const cue = {
		line: "auto" as VTTCue["line"],
		snapToLines: false,
		size: 100,
		startTime: 2,
		endTime: 5,
		text: "Hello مرحبا",
	};
	expect(positionSubtitleCue(cue)).toBe(cue);
	expect(cue).toEqual({
		line: -3,
		snapToLines: true,
		size: 100,
		startTime: 2,
		endTime: 5,
		text: "Hello مرحبا",
	});
});

it("detects WebView2 on Windows without changing Linux or other platforms", () => {
	expect(
		subtitlePlatform(
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
		),
	).toBe("windows");
	for (const agent of [
		"",
		"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15",
	])
		expect(subtitlePlatform(agent)).toBe("native");
});

it("preserves native cue width, content, timing and alignment for Linux", () => {
	const original = {
		line: "auto" as VTTCue["line"],
		snapToLines: false,
		size: 100,
		position: "auto",
		align: "center",
		startTime: 2,
		endTime: 5,
		text: "Hello مرحبا\nSecond line",
	};
	expect(positionSubtitleCue({ ...original })).toEqual({
		...original,
		line: -3,
		snapToLines: true,
	});
});

describe("sidecar parsing", () => {
	it("reads VTT identifiers/settings, multiline mixed text, BOM and CRLF without altering content", () => {
		expect(
			parseSubtitle(
				"\uFEFFWEBVTT\r\n\r\nintro\r\n00:01.250 --> 00:04.500 align:start\r\nمرحبا بالعالم\r\nHello <b>world</b>\r\n",
			),
		).toEqual([
			{ start: 1.25, end: 4.5, text: "مرحبا بالعالم\nHello <b>world</b>\n" },
		]);
	});
	it("reads numbered SRT cues including hour-long timestamps and comma milliseconds", () => {
		expect(
			parseSubtitle(
				"1\n01:02:03,400 --> 01:02:05,600\nEnglish\n\n2\n01:02:06,000 --> 01:02:07,000\nالعربية",
			),
		).toEqual([
			{ start: 3723.4, end: 3725.6, text: "English" },
			{ start: 3726, end: 3727, text: "العربية" },
		]);
	});
	it("ignores VTT comments/styles/regions instead of injecting them", () => {
		expect(
			parseSubtitle(
				`${vtt}\n\nNOTE ignored --> not a cue\ncomment\n\nSTYLE\n::cue { color: red; }\n\nREGION\nid:region`,
			),
		).toHaveLength(2);
	});
	it.each([
		"",
		"WEBVTT\n\nno captions",
		"00:60.000 --> 00:61.000\nBad",
		"00:02.000 --> 00:01.000\nBad",
		"00:02.000 --> 00:02.000\nZero-length sidecar remains invalid",
		"00:00.000-->00:01.000\nBad",
	])("rejects empty or malformed content: %s", (text) => {
		expect(() => parseSubtitle(text)).toThrow();
	});
	it("bounds cue count", () => {
		expect(() =>
			parseSubtitle(
				Array.from({ length: 10_001 }, () => "00:00.000 --> 00:01.000\nx").join(
					"\n\n",
				),
			),
		).toThrow("10,000");
	});
});

it("defaults subtitles on, persists off/on across lesson visits, and tolerates unavailable storage", () => {
	const values = new Map<string, string>();
	const storage = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
		},
	};
	expect(readSubtitlePreference(storage)).toBe(true);
	writeSubtitlePreference(storage, false);
	expect(values.get(SUBTITLE_PREFERENCE)).toBe("false");
	expect(readSubtitlePreference(storage)).toBe(false);
	writeSubtitlePreference(storage, true);
	expect(readSubtitlePreference(storage)).toBe(true);
	const broken = {
		getItem: () => {
			throw new Error("disabled");
		},
		setItem: () => {
			throw new Error("disabled");
		},
	};
	expect(readSubtitlePreference(broken)).toBe(true);
	expect(() => writeSubtitlePreference(broken, false)).not.toThrow();
});

it("clears old cues on lesson change/remount and toggles without changing playback or seeking", () => {
	const cues: TextTrackCue[] = [];
	const track = {
		mode: "disabled" as TextTrackMode,
		get cues() {
			return cues as unknown as TextTrackCueList;
		},
		addCue: (cue: TextTrackCue) => {
			cues.push(cue);
		},
		removeCue: (cue: TextTrackCue) => {
			cues.splice(cues.indexOf(cue), 1);
		},
	};
	const make = (start: number, end: number, text: string) =>
		({ startTime: start, endTime: end, text }) as unknown as TextTrackCue;
	const video = {
		currentTime: 2.5,
		paused: false,
		playbackRate: 1.25,
		textTracks: [track],
	};
	const clear = populateSubtitleTrack(track, parseSubtitle(vtt), make);
	track.mode = "showing";
	expect(
		cues.filter(
			(cue) =>
				cue.startTime <= video.currentTime && cue.endTime > video.currentTime,
		),
	).toHaveLength(1);
	track.mode = "disabled";
	expect(video.currentTime).toBe(2.5);
	expect(video.paused).toBe(false);
	clear();
	expect(cues).toHaveLength(0);
	expect(track.mode).toBe("disabled");
	populateSubtitleTrack(
		track,
		[{ start: 10, end: 20, text: "Next lesson" }],
		make,
	);
	expect(cues).toHaveLength(1);
});

it("clears partial tracks if native cue creation fails", () => {
	const track = {
		mode: "hidden" as TextTrackMode,
		cues: null,
		addCue: vi.fn(),
		removeCue: vi.fn(),
	};
	expect(() =>
		populateSubtitleTrack(track, parseSubtitle(vtt), () => {
			throw new Error("unsupported");
		}),
	).toThrow();
	expect(track.mode).toBe("disabled");
});

function deferred() {
	let resolve!: (value: SubtitleSidecar | null) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<SubtitleSidecar | null>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

it.each(["success", "error"])(
	"discards a late %s from the previous lesson",
	async (kind) => {
		const first = deferred();
		const loaded = vi.fn();
		const failed = vi.fn();
		const cancel = loadSubtitle(() => first.promise, loaded, failed);
		cancel();
		loadSubtitle(
			async () => ({ filename: "second.vtt", content: vtt }),
			loaded,
			failed,
		);
		if (kind === "success")
			first.resolve({ filename: "first.vtt", content: vtt });
		else first.reject(new Error("old failure"));
		await vi.waitFor(() => expect(loaded).toHaveBeenCalledOnce());
		expect(loaded.mock.calls[0][0].filename).toBe("second.vtt");
		expect(failed).not.toHaveBeenCalled();
	},
);

it("reports read/parse failures without throwing into playback; missing subtitles are normal", async () => {
	const loaded = vi.fn();
	const failed = vi.fn();
	loadSubtitle(async () => null, loaded, failed);
	await vi.waitFor(() => expect(loaded).toHaveBeenCalledWith(null));
	loadSubtitle(
		async () => ({ filename: "bad.srt", content: "broken" }),
		loaded,
		failed,
	);
	await vi.waitFor(() =>
		expect(failed).toHaveBeenCalledWith("Subtitle contains no readable cues."),
	);
});
