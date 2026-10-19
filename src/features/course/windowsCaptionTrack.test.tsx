import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { WindowsSubtitles } from "@/features/course/WindowsSubtitles";
import {
	activeCaptionText,
	bindWindowsSubtitles,
} from "@/features/course/windowsCaptionTrack";

const cue = (text: string) =>
	({ getCueAsHTML: () => ({ textContent: text }) }) as unknown as TextTrackCue;
function fixture(enabled = true) {
	const video = Object.assign(new EventTarget(), {
		readyState: 4,
		seeking: false,
		ended: false,
		error: null as MediaError | null,
		currentTime: 4,
		paused: true,
	});
	const track = Object.assign(new EventTarget(), {
		mode: "disabled" as TextTrackMode,
		activeCues: [cue("First\nمرحبا Hello")] as unknown as TextTrackCueList,
	});
	const tracks = new EventTarget();
	const text = vi.fn();
	const preference = vi.fn();
	const binding = bindWindowsSubtitles(
		video,
		track,
		tracks,
		enabled,
		text,
		preference,
	);
	return { video, track, tracks, text, preference, binding };
}
it("uses a hidden timed track and updates captions while playing or seeking when paused", () => {
	const f = fixture();
	expect(f.track.mode).toBe("hidden");
	expect(f.text).toHaveBeenLastCalledWith("First\nمرحبا Hello");
	f.track.activeCues = [cue("Next")] as unknown as TextTrackCueList;
	f.track.dispatchEvent(new Event("cuechange"));
	expect(f.text).toHaveBeenLastCalledWith("Next");
	f.video.seeking = true;
	f.video.dispatchEvent(new Event("seeking"));
	expect(f.text).toHaveBeenLastCalledWith("");
	f.track.dispatchEvent(new Event("cuechange"));
	expect(f.text).toHaveBeenLastCalledWith("");
	f.video.seeking = false;
	f.track.activeCues = [cue("After seek")] as unknown as TextTrackCueList;
	f.video.dispatchEvent(new Event("seeked"));
	expect(f.text).toHaveBeenLastCalledWith("After seek");
	expect(f.video.currentTime).toBe(4);
	expect(f.video.paused).toBe(true);
	f.binding.dispose();
});
it("honors toggle and native CC changes without duplicate captions or cleanup preference changes", () => {
	const f = fixture(false);
	expect(f.text).toHaveBeenLastCalledWith("");
	f.binding.setEnabled(true);
	f.tracks.dispatchEvent(new Event("change"));
	expect(f.track.mode).toBe("hidden");
	expect(f.preference).not.toHaveBeenCalled();
	f.track.mode = "disabled";
	f.tracks.dispatchEvent(new Event("change"));
	expect(f.preference).toHaveBeenLastCalledWith(false);
	expect(f.text).toHaveBeenLastCalledWith("");
	f.track.mode = "showing";
	f.tracks.dispatchEvent(new Event("change"));
	expect(f.preference).toHaveBeenLastCalledWith(true);
	expect(f.track.mode).toBe("hidden");
	f.binding.setEnabled(false);
	expect(f.text).toHaveBeenLastCalledWith("");
	const count = f.preference.mock.calls.length;
	f.binding.dispose();
	f.tracks.dispatchEvent(new Event("change"));
	expect(f.preference).toHaveBeenCalledTimes(count);
});
it.each(["error", "emptied", "ended"])(
	"clears on %s and detaches old lesson listeners",
	(event) => {
		const f = fixture();
		if (event === "error") f.video.error = {} as MediaError;
		if (event === "emptied") f.video.readyState = 0;
		if (event === "ended") f.video.ended = true;
		f.video.dispatchEvent(new Event(event));
		expect(f.text).toHaveBeenLastCalledWith("");
		f.video.dispatchEvent(new Event("timeupdate"));
		expect(f.text).toHaveBeenLastCalledWith("");
		f.binding.dispose();
		const count = f.text.mock.calls.length;
		f.video.error = null;
		f.video.readyState = 4;
		f.video.ended = false;
		f.track.dispatchEvent(new Event("cuechange"));
		f.video.dispatchEvent(new Event("seeked"));
		f.binding.setEnabled(true);
		expect(f.text).toHaveBeenCalledTimes(count);
		const next = fixture();
		next.track.activeCues = [cue("New lesson")] as unknown as TextTrackCueList;
		next.track.dispatchEvent(new Event("cuechange"));
		expect(next.text).toHaveBeenLastCalledWith("New lesson");
		next.binding.dispose();
	},
);
it("preserves overlapping multiline mixed-language cues and renders plain text safely", () => {
	expect(activeCaptionText(null)).toBe("");
	expect(activeCaptionText([cue("Hello\nمرحبا"), cue("Second")])).toBe(
		"Hello\nمرحبا\nSecond",
	);
	const text = '<img src=x onerror="bad()"> Hello & مرحبا';
	const html = renderToStaticMarkup(
		<WindowsSubtitles text={text} expanded={false} />,
	);
	expect(html).not.toContain("<img");
	expect(html).toContain("&lt;img");
	expect(html).toContain('dir="auto"');
	expect(html).toContain("pointer-events-none");
	expect(html).toContain("bottom-16");
	expect(html).toContain("text-[18px]");
	expect(html).toContain("whitespace-pre-line");
	expect(
		renderToStaticMarkup(<WindowsSubtitles text="" expanded={false} />),
	).toBe("");
	expect(
		renderToStaticMarkup(<WindowsSubtitles text="Caption" expanded />),
	).toContain("text-[22px]");
});
