import { afterEach, expect, it, vi } from "vitest";
import {
	discoverDurations,
	lessonTime,
	readVideoDuration,
	sectionTime,
} from "@/features/course/durations";
import { buildOutline } from "@/features/course/outline";
import type { OutlineLesson } from "@/lib/db/courseOutline";

const lesson = (
	id: number,
	duration_seconds: number | null = null,
): OutlineLesson => ({
	id,
	course_id: 1,
	title: String(id),
	relative_path: `Section/${id}.mp4`,
	sort_order: id,
	completed: false,
	missing_at: null,
	duration_seconds,
});
afterEach(() => vi.useRealTimers());

it("formats lesson times and honest complete section totals", () => {
	expect(lessonTime(760)).toBe("12:40");
	expect(lessonTime(3670)).toBe("1:01:10");
	for (const invalid of [null, undefined, NaN, Infinity, 0, -1])
		expect(lessonTime(invalid)).toBe("—");
	expect(sectionTime([lesson(1, 3600), lesson(2, 3120)])).toBe("1h 52m");
	expect(sectionTime([lesson(1, 2280)])).toBe("38 min");
	expect(sectionTime([lesson(1, 1)])).toBe("1 min");
	expect(sectionTime([lesson(1, 3600), lesson(2)])).toBe("—");
	expect(sectionTime([])).toBe("—");
	expect(
		buildOutline([lesson(1, 60), { ...lesson(2, 300), missing_at: "now" }], 1)
			.sections[0].durationLabel,
	).toBe("1 min");
});

class FakeVideo extends EventTarget {
	readyState = 0;
	duration = NaN;
	preload = "";
	src = "";
	load = vi.fn();
	removeAttribute = vi.fn();
	play = vi.fn();
}

it("only reads metadata, releases media resources and never plays", async () => {
	const video = new FakeVideo();
	const read = readVideoDuration(
		"local-media",
		new AbortController().signal,
		() => video as unknown as HTMLVideoElement,
	);
	video.readyState = 1;
	video.duration = 760;
	video.dispatchEvent(new Event("loadedmetadata"));
	expect(await read).toBe(760);
	expect(video.play).not.toHaveBeenCalled();
	expect(video.removeAttribute).toHaveBeenCalledWith("src");
	expect(video.load).toHaveBeenCalledTimes(2);
});

it("handles media errors, timeouts and cancellation without persisting bogus values", async () => {
	vi.useFakeTimers();
	for (const action of ["error", "timeout", "abort"]) {
		const video = new FakeVideo();
		const abort = new AbortController();
		const read = readVideoDuration(
			"local-media",
			abort.signal,
			() => video as unknown as HTMLVideoElement,
		);
		if (action === "error") video.dispatchEvent(new Event("error"));
		if (action === "timeout") await vi.advanceTimersByTimeAsync(10000);
		if (action === "abort") abort.abort();
		expect(await read).toBeNull();
		expect(video.removeAttribute).toHaveBeenCalledWith("src");
	}
});

it("skips cached lessons, bounds concurrency to two and continues after failures", async () => {
	let active = 0;
	let peak = 0;
	const read = vi.fn(async (row: OutlineLesson) => {
		active++;
		peak = Math.max(peak, active);
		await Promise.resolve();
		active--;
		if (row.id === 2) throw new Error("unavailable");
		return 60;
	});
	const save = vi.fn(async () => {});
	await discoverDurations(
		[lesson(1, 10), lesson(2), lesson(3), lesson(4)],
		new AbortController().signal,
		read,
		save,
	);
	expect(peak).toBe(2);
	expect(read).toHaveBeenCalledTimes(3);
	expect(save).toHaveBeenCalledTimes(2);
});

it("discards in-flight metadata after leaving the course", async () => {
	const abort = new AbortController();
	const save = vi.fn(async () => {});
	await discoverDurations(
		[lesson(1), lesson(2), lesson(3)],
		abort.signal,
		async () => {
			abort.abort();
			return 60;
		},
		save,
	);
	expect(save).not.toHaveBeenCalled();
});
