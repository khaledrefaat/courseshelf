import { afterEach, expect, it, vi } from "vitest";
import { createAutoAdvance } from "@/features/course/autoAdvance";
import {
	flushPendingData,
	registerProgressFlush,
} from "@/features/course/closeProgress";
import { trackPlayback } from "@/features/course/playbackTracking";
import { openFlashcardReview } from "@/features/flashcards/openReview";
import { trackProgressWrite } from "@/lib/db/progressWrites";

afterEach(() => vi.useRealTimers());
it("review invalidates countdown even while its existing flush is in flight", async () => {
	vi.useFakeTimers();
	let finish!: () => void;
	const advance = vi.fn(),
		opened = vi.fn(),
		exit = vi.fn(async () => {});
	const countdown = createAutoAdvance({
		canAdvance: () => true,
		beforeStart: async () => {},
		flush: () =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
		advance,
		changed: () => {},
		failed: vi.fn(),
		now: () => Date.now(),
	});
	await countdown.ended();
	await vi.advanceTimersByTimeAsync(5000);
	await openFlashcardReview({
		cancel: countdown.cancel,
		exitFullscreen: exit,
		current: () => true,
		open: opened,
	});
	finish();
	await vi.advanceTimersByTimeAsync(100);
	expect(opened).toHaveBeenCalledOnce();
	expect(exit).toHaveBeenCalledOnce();
	expect(advance).not.toHaveBeenCalled();
	countdown.dispose();
});
it("waits for fullscreen restoration and does not open a different lesson after navigation", async () => {
	let finish!: () => void;
	let current = true;
	const cancelled = vi.fn(),
		opened = vi.fn();
	const request = openFlashcardReview({
		cancel: cancelled,
		exitFullscreen: () =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
		current: () => current,
		open: opened,
	});
	expect(cancelled).toHaveBeenCalledOnce();
	expect(opened).not.toHaveBeenCalled();
	current = false;
	finish();
	await request;
	expect(opened).not.toHaveBeenCalled();
});

it("does not open review if fullscreen restoration fails", async () => {
	const opened = vi.fn();
	await expect(
		openFlashcardReview({
			cancel: () => {},
			exitFullscreen: async () => {
				throw new Error("fullscreen failed");
			},
			current: () => true,
			open: opened,
		}),
	).rejects.toThrow("fullscreen failed");
	expect(opened).not.toHaveBeenCalled();
});

it("90% completion alone never opens review; a real end opens review without auto-advance and shared flush saves normally", async () => {
	vi.useFakeTimers();
	const video = Object.assign(new EventTarget(), {
		currentTime: 0,
		duration: 100,
		readyState: 1,
		paused: true,
		seeking: false,
		error: null,
	});
	const writes: string[] = [],
		opened = vi.fn();
	let release!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	const tracking = trackPlayback(video, {
		savedPosition: 0,
		completed: false,
		save: (position) =>
			trackProgressWrite(() =>
				pending.then(() => {
					writes.push(`position:${position}`);
				}),
			),
		complete: () =>
			trackProgressWrite(() =>
				pending.then(() => {
					writes.push("complete");
				}),
			),
		onResume: vi.fn(),
		onReady: vi.fn(),
		onError: vi.fn(),
	});
	const unregister = registerProgressFlush(tracking.flush);
	const countdown = createAutoAdvance({
		canAdvance: () => true,
		beforeStart: async () => {},
		flush: flushPendingData,
		advance: () => {
			writes.push("timer advance");
		},
		changed: () => {},
		failed: vi.fn(),
		review: {
			canOpen: () => true,
			open: async () => {
				opened();
			},
		},
	});
	const ended = () => {
		void countdown.ended();
	};
	video.addEventListener("ended", ended);
	try {
		video.paused = false;
		video.dispatchEvent(new Event("play"));
		video.currentTime = 90;
		video.dispatchEvent(new Event("timeupdate"));
		expect(opened).not.toHaveBeenCalled();
		video.currentTime = 100;
		video.paused = true;
		video.dispatchEvent(new Event("ended"));
		expect(opened).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(6000);
		expect(writes).toEqual([]);
		const flushed = flushPendingData();
		await Promise.resolve();
		expect(writes).toEqual([]);
		release();
		await flushed;
		expect(writes).toContain("position:100");
		expect(writes).toContain("complete");
		expect(writes).not.toContain("timer advance");
	} finally {
		release();
		countdown.dispose();
		video.removeEventListener("ended", ended);
		tracking.dispose();
		unregister();
		await flushPendingData();
	}
});
