import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	bindAutoAdvanceEvents,
	createAutoAdvance,
} from "@/features/course/autoAdvance";
import {
	flushPendingData,
	registerProgressFlush,
} from "@/features/course/closeProgress";
import { trackPlayback } from "@/features/course/playbackTracking";
import { trackProgressWrite } from "@/lib/db/progressWrites";

function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function fixture() {
	const options = {
		canAdvance: vi.fn(() => true),
		beforeStart: vi.fn(async () => {}),
		flush: vi.fn(async () => {}),
		advance: vi.fn(),
		changed: vi.fn(),
		failed: vi.fn(),
		now: () => Date.now(),
	};
	return { options, controller: createAutoAdvance(options) };
}
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

it("counts down five seconds, flushes, advances once; repeated ended is ignored", async () => {
	const f = fixture();
	await f.controller.ended();
	await f.controller.ended();
	expect(f.options.changed).toHaveBeenLastCalledWith({
		seconds: 5,
		flushing: false,
	});
	await vi.advanceTimersByTimeAsync(4000);
	expect(f.options.changed).toHaveBeenLastCalledWith({
		seconds: 1,
		flushing: false,
	});
	expect(f.options.advance).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(1000);
	expect(f.options.flush).toHaveBeenCalledBefore(f.options.advance);
	expect(f.options.advance).toHaveBeenCalledOnce();
	await f.controller.ended();
	expect(f.options.beforeStart).toHaveBeenCalledOnce();
});
it("does not start on the final lesson or when blocked", async () => {
	const f = fixture();
	f.options.canAdvance.mockReturnValue(false);
	await f.controller.ended();
	expect(f.options.beforeStart).not.toHaveBeenCalled();
	expect(f.options.changed).not.toHaveBeenCalled();
});
it("cancel stays cancelled until replay/seek resets the visit", async () => {
	const f = fixture();
	await f.controller.ended();
	expect(f.controller.cancel()).toBe(true);
	expect(f.controller.cancel()).toBe(false);
	await f.controller.ended();
	await vi.advanceTimersByTimeAsync(6000);
	expect(f.options.advance).not.toHaveBeenCalled();
	f.controller.reset();
	await f.controller.ended();
	await vi.advanceTimersByTimeAsync(5000);
	expect(f.options.advance).toHaveBeenCalledOnce();
});
it.each(["preparing", "flushing"])(
	"cancel invalidates asynchronous %s work",
	async (phase) => {
		const f = fixture();
		const pending = deferred();
		if (phase === "preparing")
			f.options.beforeStart.mockReturnValue(pending.promise);
		else f.options.flush.mockReturnValue(pending.promise);
		const starting = f.controller.ended();
		if (phase === "flushing") {
			await starting;
			await vi.advanceTimersByTimeAsync(5000);
		}
		expect(f.controller.cancel()).toBe(true);
		pending.resolve();
		await starting;
		await vi.advanceTimersByTimeAsync(6000);
		expect(f.options.advance).not.toHaveBeenCalled();
		expect(f.options.failed).not.toHaveBeenCalled();
	},
);
it("rechecks target availability during countdown and after flushing", async () => {
	for (const duringFlush of [false, true]) {
		const f = fixture();
		const pending = deferred();
		f.options.flush.mockReturnValue(pending.promise);
		await f.controller.ended();
		if (duringFlush) await vi.advanceTimersByTimeAsync(5000);
		f.options.canAdvance.mockReturnValue(false);
		pending.resolve();
		await vi.advanceTimersByTimeAsync(6000);
		expect(f.options.advance).not.toHaveBeenCalled();
		expect(f.options.changed).toHaveBeenLastCalledWith(null);
	}
});
it.each(["beforeStart", "flush"] as const)(
	"handles %s rejection without navigating",
	async (method) => {
		const f = fixture();
		f.options[method].mockRejectedValue(new Error("failed"));
		await f.controller.ended();
		await vi.advanceTimersByTimeAsync(5000);
		expect(f.options.failed).toHaveBeenCalledOnce();
		expect(f.options.changed).toHaveBeenLastCalledWith(null);
		expect(f.options.advance).not.toHaveBeenCalled();
	},
);
it.each([
	"play",
	"seeking",
	"error",
	"emptied",
	"loadstart",
	"visibilitychange",
	"pagehide",
	"unmount",
])("cancels on %s", async (event) => {
	const f = fixture();
	const video = new EventTarget();
	const doc = Object.assign(new EventTarget(), { hidden: false });
	const page = new EventTarget();
	const cleanup = bindAutoAdvanceEvents(video, doc, page, f.controller);
	video.dispatchEvent(new Event("ended"));
	await Promise.resolve();
	if (event === "unmount") cleanup();
	else if (event === "visibilitychange") {
		doc.hidden = true;
		doc.dispatchEvent(new Event(event));
	} else (event === "pagehide" ? page : video).dispatchEvent(new Event(event));
	await vi.advanceTimersByTimeAsync(6000);
	expect(f.options.advance).not.toHaveBeenCalled();
	cleanup();
});

it("real tracking saves the final position and completes before advancing; 90% alone never starts countdown", async () => {
	const video = Object.assign(new EventTarget(), {
		currentTime: 0,
		duration: 100,
		readyState: 1,
		paused: true,
		seeking: false,
		error: null,
	});
	const writes: string[] = [];
	const pending = deferred();
	const tracking = trackPlayback(video, {
		savedPosition: 0,
		completed: false,
		save: (position) =>
			trackProgressWrite(() =>
				pending.promise.then(() => {
					writes.push(`position:${position}`);
				}),
			),
		complete: () =>
			trackProgressWrite(() =>
				pending.promise.then(() => {
					writes.push("complete");
				}),
			),
		onResume: vi.fn(),
		onReady: vi.fn(),
		onError: vi.fn(),
		now: () => Date.now(),
	});
	const unregister = registerProgressFlush(tracking.flush);
	const f = fixture();
	f.options.flush.mockImplementation(flushPendingData);
	f.options.advance.mockImplementation(() => {
		writes.push("advance");
	});
	const cleanup = bindAutoAdvanceEvents(
		video,
		Object.assign(new EventTarget(), { hidden: false }),
		new EventTarget(),
		f.controller,
	);
	try {
		video.paused = false;
		video.dispatchEvent(new Event("play"));
		video.currentTime = 90;
		video.dispatchEvent(new Event("timeupdate"));
		expect(f.options.beforeStart).not.toHaveBeenCalled();
		video.currentTime = 100;
		video.paused = true;
		video.dispatchEvent(new Event("ended"));
		await Promise.resolve();
		await vi.advanceTimersByTimeAsync(5000);
		expect(f.options.advance).not.toHaveBeenCalled();
		pending.resolve();
		await vi.advanceTimersByTimeAsync(0);
		expect(writes).toContain("position:100");
		expect(writes).toContain("complete");
		expect(writes[writes.length - 1]).toBe("advance");
		expect(writes).not.toContain("position:0");
	} finally {
		pending.resolve();
		cleanup();
		tracking.dispose();
		unregister();
		await flushPendingData();
	}
});
