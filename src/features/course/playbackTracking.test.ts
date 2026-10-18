import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { trackPlayback } from "@/features/course/playbackTracking";
import { playerShortcuts } from "@/features/course/playerShortcuts";
import { startPosition } from "@/features/course/trackingRules";

class FakeVideo extends EventTarget {
	private position = 0;
	nativeSeekEvents = false;
	volume = 1;
	muted = false;
	ended = false;
	get currentTime() {
		return this.position;
	}
	set currentTime(value: number) {
		this.position = value;
		if (this.nativeSeekEvents) {
			this.seeking = true;
			this.emit("seeking");
		}
	}
	duration = 100;
	readyState = 0;
	paused = true;
	seeking = false;
	error: unknown = null;
	emit(name: string) {
		this.dispatchEvent(new Event(name));
	}
	metadata() {
		this.readyState = 1;
		this.emit("loadedmetadata");
	}
	play() {
		this.paused = false;
		this.emit("play");
	}
	pause() {
		this.paused = true;
		this.emit("pause");
	}
	finishNativeSeek() {
		this.seeking = false;
		this.emit("seeked");
		this.emit("timeupdate");
		if (!this.paused && this.currentTime === this.duration) {
			this.ended = true;
			this.paused = true;
			this.emit("ended");
		}
	}
	seeked(position: number) {
		this.currentTime = position;
		this.seeking = false;
		this.emit("seeked");
	}
	seek(position: number) {
		this.seeking = true;
		this.emit("seeking");
		this.seeked(position);
	}
}
function fixture(savedPosition = 0, completed = false) {
	const video = new FakeVideo();
	const save = vi.fn(async (_position: number) => {});
	const complete = vi.fn(async () => {});
	const onResume = vi.fn();
	const onReady = vi.fn();
	const onError = vi.fn();
	const controller = trackPlayback(video, {
		savedPosition,
		completed,
		save,
		complete,
		onResume,
		onReady,
		onError,
		now: () => Date.now(),
	});
	return { video, save, complete, onResume, onReady, onError, controller };
}
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

it("does not overwrite a saved position with the transient zero before the resume seek finishes", () => {
	const f = fixture(42);
	f.video.play();
	f.controller.flush();
	f.video.metadata();
	expect(f.video.currentTime).toBe(42);
	f.video.currentTime = 0;
	// Advance the decision clock without running the seek-retry timers.
	vi.setSystemTime(5000);
	f.video.emit("timeupdate");
	f.video.emit("pause");
	f.controller.flush();
	expect(f.save).not.toHaveBeenCalled();
	vi.advanceTimersByTime(5000);
	// Even after retry exhaustion, the zero remains protected.
	f.video.currentTime = 0;
	f.video.emit("timeupdate");
	f.video.emit("pause");
	f.controller.flush();
	expect(f.save).not.toHaveBeenCalled();
	f.controller.dispose();
});
it("unblocks only after seeked confirms the target, and does not autoplay on resume", () => {
	const f = fixture(42);
	f.video.metadata();
	expect(f.onReady).not.toHaveBeenCalled();
	f.video.currentTime = 0;
	f.video.emit("pause");
	f.video.seeked(42);
	expect(f.onResume).toHaveBeenCalledWith(42);
	expect(f.onReady).toHaveBeenCalledTimes(1);
	expect(f.video.paused).toBe(true);
	f.video.play();
	f.video.currentTime = 44;
	f.video.emit("pause");
	expect(f.save).toHaveBeenLastCalledWith(44);
	f.controller.dispose();
});
it("caps failed resume retries and preserves the stored floor until playback passes it", () => {
	const f = fixture(42);
	f.video.metadata();
	vi.advanceTimersByTime(2250);
	expect(f.onReady).toHaveBeenCalledTimes(1);
	expect(f.onResume).not.toHaveBeenCalled();
	f.video.play();
	f.video.currentTime = 20;
	f.controller.flush();
	expect(f.save).not.toHaveBeenCalled();
	f.video.currentTime = 43;
	f.controller.flush();
	expect(f.save).toHaveBeenCalledWith(43);
	f.controller.dispose();
});
it("explicit seeking releases failed-resume protection", () => {
	const f = fixture(42);
	f.video.metadata();
	vi.advanceTimersByTime(2250);
	f.video.seek(10);
	f.controller.flush();
	expect(f.save).toHaveBeenCalledWith(10);
	f.controller.dispose();
});
it("Start over immediately saves zero and releases protection even before its seeked event", () => {
	const f = fixture(42);
	f.video.metadata();
	vi.advanceTimersByTime(2250);
	f.video.seeking = true;
	f.controller.startOver();
	expect(f.save).toHaveBeenCalledWith(0);
	expect(f.onResume).toHaveBeenCalledWith(null);
	f.video.seeked(0);
	f.video.play();
	f.video.currentTime = 3;
	f.controller.flush();
	expect(f.save).toHaveBeenLastCalledWith(3);
	f.controller.dispose();
});
it("periodic saves are throttled while pause/hidden/navigation flushes save the latest value", () => {
	const f = fixture();
	f.video.metadata();
	f.video.play();
	f.video.currentTime = 4;
	vi.advanceTimersByTime(4999);
	f.video.emit("timeupdate");
	expect(f.save).not.toHaveBeenCalled();
	vi.advanceTimersByTime(1);
	f.video.emit("timeupdate");
	expect(f.save).toHaveBeenLastCalledWith(4);
	f.video.currentTime = 4.5;
	vi.advanceTimersByTime(5000);
	f.video.emit("timeupdate");
	expect(f.save).toHaveBeenCalledTimes(1);
	f.video.emit("pause");
	expect(f.save).toHaveBeenLastCalledWith(4.5);
	f.video.currentTime = 5;
	f.controller.flush();
	expect(f.save).toHaveBeenLastCalledWith(5);
	f.video.currentTime = 6;
	f.controller.dispose();
	expect(f.save).toHaveBeenLastCalledWith(6);
	f.video.currentTime = 7;
	f.video.emit("pause");
	expect(f.save).toHaveBeenCalledTimes(4);
});
it("never saves opening alone, initial under-two-second positions, errors, unknown durations or mid-seeks", () => {
	const f = fixture();
	f.video.metadata();
	f.controller.flush();
	f.video.play();
	f.video.currentTime = 1.9;
	f.controller.flush();
	f.video.currentTime = 10;
	f.video.error = {};
	f.controller.flush();
	f.video.error = null;
	f.video.duration = Infinity;
	f.controller.flush();
	f.video.duration = Number.NaN;
	f.controller.flush();
	f.video.duration = 100;
	f.video.seeking = true;
	f.controller.flush();
	expect(f.save).not.toHaveBeenCalled();
	f.controller.dispose();
});
it("completes at 90 percent only while playing, once per visit, with undo suppressing all later completion", () => {
	const f = fixture();
	f.video.metadata();
	f.video.currentTime = 90;
	f.video.emit("timeupdate");
	expect(f.complete).not.toHaveBeenCalled();
	f.video.play();
	f.video.seeking = true;
	f.video.emit("timeupdate");
	expect(f.complete).not.toHaveBeenCalled();
	f.video.seeking = false;
	f.video.emit("timeupdate");
	f.video.emit("timeupdate");
	expect(f.complete).toHaveBeenCalledTimes(1);
	f.controller.updateCompleted(true);
	f.controller.updateCompleted(false);
	f.video.emit("ended");
	expect(f.complete).toHaveBeenCalledTimes(1);
	f.controller.dispose();
	const nextVisit = fixture();
	nextVisit.video.metadata();
	nextVisit.video.play();
	nextVisit.video.currentTime = 90;
	nextVisit.video.emit("timeupdate");
	expect(nextVisit.complete).toHaveBeenCalledTimes(1);
	nextVisit.controller.dispose();
});
it("does nothing for completed lessons and suppresses auto-completion when a previously completed lesson is undone", () => {
	const f = fixture(0, true);
	f.video.metadata();
	f.video.play();
	f.video.currentTime = 90;
	f.video.emit("timeupdate");
	expect(f.complete).not.toHaveBeenCalled();
	f.controller.updateCompleted(false);
	f.video.emit("timeupdate");
	f.video.emit("ended");
	expect(f.complete).not.toHaveBeenCalled();
	f.controller.dispose();
});
it("ended saves exactly duration, marks complete, and the next visit starts from zero (including short videos)", () => {
	const f = fixture();
	f.video.duration = 20;
	f.video.metadata();
	f.video.play();
	f.video.currentTime = 19;
	f.video.emit("timeupdate");
	expect(f.complete).not.toHaveBeenCalled();
	f.video.currentTime = f.video.duration;
	f.video.paused = true;
	f.video.emit("ended");
	expect(f.save).toHaveBeenLastCalledWith(20);
	expect(f.complete).toHaveBeenCalledTimes(1);
	expect(startPosition(20, 20, false)).toBe(0);
	expect(startPosition(20, 20, true)).toBe(0);
	f.controller.dispose();
});

it("waits for metadata and a finite duration and handles a cached metadata-ready video", () => {
	const f = fixture(42);
	f.video.emit("loadedmetadata");
	expect(f.onReady).not.toHaveBeenCalled();
	f.video.duration = Infinity;
	f.video.metadata();
	expect(f.onReady).not.toHaveBeenCalled();
	f.video.duration = 100;
	f.video.emit("durationchange");
	f.video.seeked(42);
	expect(f.onReady).toHaveBeenCalledOnce();
	f.controller.dispose();
	const video = new FakeVideo();
	video.readyState = 2;
	const onReady = vi.fn();
	const controller = trackPlayback(video, {
		savedPosition: 0,
		completed: false,
		save: vi.fn(),
		complete: vi.fn(),
		onResume: vi.fn(),
		onReady,
		onError: vi.fn(),
	});
	expect(onReady).toHaveBeenCalledOnce();
	controller.dispose();
});

it("reports failed saves without unhandled rejections and can retry the unsaved position", async () => {
	const f = fixture();
	f.video.metadata();
	f.video.play();
	f.video.currentTime = 10;
	f.save.mockRejectedValueOnce(new Error("disk full"));
	f.controller.flush();
	await Promise.resolve();
	expect(f.onError).toHaveBeenCalledOnce();
	f.controller.flush();
	expect(f.save).toHaveBeenCalledTimes(2);
	f.controller.dispose();
});

function keyboard(f: ReturnType<typeof fixture>) {
	const controller = playerShortcuts({
		video: () => f.video,
		canSeek: f.controller.canSeek,
		focus: vi.fn(),
		indicate: vi.fn(),
		toggleFullscreen: vi.fn(),
		exitFullscreen: vi.fn(),
		isFullscreen: () => false,
	});
	return (key: string) =>
		controller.keydown(
			Object.assign(new Event("keydown", { cancelable: true }), {
				key,
				code: key,
				repeat: false,
				isComposing: false,
				ctrlKey: false,
				altKey: false,
				metaKey: false,
			}),
			{ blocked: false, activationTarget: false },
		);
}

it("keyboard seeks cannot change or save the transient zero before resume confirmation", () => {
	const f = fixture(42);
	f.video.nativeSeekEvents = true;
	const key = keyboard(f);
	f.video.metadata();
	f.video.currentTime = 0;
	f.video.play();
	vi.setSystemTime(6000);
	key("ArrowRight");
	expect(f.video.currentTime).toBe(0);
	f.video.emit("timeupdate");
	f.controller.flush();
	expect(f.save).not.toHaveBeenCalled();
	f.video.seeked(42);
	key("ArrowRight");
	expect(f.video.currentTime).toBe(52);
	f.controller.flush();
	expect(f.save).not.toHaveBeenCalled(); // Mid-seek is also protected.
	f.video.finishNativeSeek();
	expect(f.save).toHaveBeenLastCalledWith(52);
	f.controller.dispose();
});

it("a playing keyboard seek past 90 percent completes only after native seeking ends, and respects Undo", () => {
	const f = fixture();
	f.video.metadata();
	f.video.play();
	f.video.nativeSeekEvents = true;
	f.video.currentTime = 85;
	f.video.finishNativeSeek();
	const key = keyboard(f);
	key("ArrowRight");
	expect(f.video.currentTime).toBe(95);
	f.video.emit("timeupdate");
	expect(f.complete).not.toHaveBeenCalled();
	f.video.finishNativeSeek();
	expect(f.complete).toHaveBeenCalledOnce();
	f.controller.updateCompleted(true);
	f.controller.updateCompleted(false);
	key("ArrowLeft");
	f.video.finishNativeSeek();
	key("ArrowRight");
	f.video.finishNativeSeek();
	expect(f.complete).toHaveBeenCalledOnce();
	f.controller.dispose();
});

it("a keyboard seek beyond the end clamps, lets the media emit ended and saves the final position, never zero", () => {
	const f = fixture();
	f.video.duration = 20;
	f.video.metadata();
	f.video.play();
	f.video.nativeSeekEvents = true;
	f.video.currentTime = 19;
	f.video.finishNativeSeek();
	keyboard(f)("ArrowRight");
	expect(f.video.currentTime).toBe(20);
	expect(f.video.ended).toBe(false);
	expect(f.complete).not.toHaveBeenCalled();
	f.video.finishNativeSeek();
	expect(f.video.ended).toBe(true);
	expect(f.video.paused).toBe(true);
	expect(f.save).toHaveBeenLastCalledWith(20);
	expect(f.complete).toHaveBeenCalledOnce();
	expect(startPosition(20, 20, true)).toBe(0);
	f.controller.dispose();
});
