import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	bindAutoAdvanceEvents,
	createAutoAdvance,
	lessonEndReady,
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

it("requires an actual metadata-ready end, without seeking/errors/hidden page/popups/management", () => {
	const video = {
		ended: true,
		seeking: false,
		error: null,
		duration: 100,
		readyState: 1,
	};
	const page = { blocked: false, hidden: false, popup: false };
	expect(lessonEndReady(video, page)).toBe(true);
	for (const patch of [
		{ ended: false },
		{ seeking: true },
		{ error: "failed" },
		{ duration: NaN },
		{ duration: 0 },
		{ readyState: 0 },
	])
		expect(lessonEndReady({ ...video, ...patch }, page)).toBe(false);
	for (const key of ["blocked", "hidden", "popup"])
		expect(lessonEndReady(video, { ...page, [key]: true })).toBe(false);
});

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

it("saved review owns the end instead of starting a timer, including the final lesson", async () => {
	for (const final of [false, true]) {
		const f = fixture();
		f.options.canAdvance.mockReturnValue(!final);
		const open = vi.fn(async (current: () => boolean) =>
			expect(current()).toBe(true),
		);
		const controller = createAutoAdvance({
			...f.options,
			review: { canOpen: () => true, open },
		});
		await controller.ended();
		await controller.ended();
		await controller.advanceNow();
		await vi.advanceTimersByTimeAsync(10000);
		expect(open).toHaveBeenCalledOnce();
		expect(f.options.beforeStart).not.toHaveBeenCalled();
		expect(f.options.advance).not.toHaveBeenCalled();
		expect(f.options.changed).not.toHaveBeenCalled();
		// Cancellation does not restart a countdown; replay permits another end.
		controller.cancel();
		await controller.ended();
		expect(open).toHaveBeenCalledOnce();
		controller.reset();
		await controller.ended();
		expect(open).toHaveBeenCalledTimes(2);
		controller.dispose();
	}
});
function reviewFixture() {
	const f = fixture();
	let close: (() => Promise<void>) | undefined;
	const controller = createAutoAdvance({
		...f.options,
		review: {
			canOpen: () => true,
			open: async (_current, closed) => {
				close = closed;
			},
		},
	});
	return {
		...f,
		controller,
		close: () => {
			if (!close) throw new Error("Review has not opened");
			return close();
		},
	};
}
it("closing end review flushes saves then advances once without a countdown", async () => {
	const f = reviewFixture(),
		pending = deferred();
	f.options.flush.mockReturnValue(pending.promise);
	await f.controller.ended();
	await vi.advanceTimersByTimeAsync(6000);
	expect(f.options.flush).not.toHaveBeenCalled();
	const closing = f.close();
	await f.close();
	expect(f.options.flush).toHaveBeenCalledOnce();
	expect(f.options.advance).not.toHaveBeenCalled();
	pending.resolve();
	await closing;
	await f.close();
	await f.controller.ended();
	expect(f.options.flush).toHaveBeenCalledBefore(f.options.advance);
	expect(f.options.advance).toHaveBeenCalledOnce();
	expect(f.options.beforeStart).not.toHaveBeenCalled();
	expect(vi.getTimerCount()).toBe(0);
});
it("closing final-lesson review stays put without flushing or restarting a timer", async () => {
	const f = reviewFixture();
	f.options.canAdvance.mockReturnValue(false);
	await f.controller.ended();
	await f.close();
	await f.controller.ended();
	await vi.advanceTimersByTimeAsync(6000);
	expect(f.options.flush).not.toHaveBeenCalled();
	expect(f.options.advance).not.toHaveBeenCalled();
});
it.each(["cancel", "reset", "dispose", "blocked"] as const)(
	"does not advance when review dismissal is invalidated by %s, including during saves",
	async (action) => {
		for (const flushing of [false, true]) {
			const f = reviewFixture(),
				pending = deferred();
			f.options.flush.mockReturnValue(pending.promise);
			await f.controller.ended();
			const closing = flushing ? f.close() : Promise.resolve();
			if (action === "blocked") f.options.canAdvance.mockReturnValue(false);
			else f.controller[action]();
			if (!flushing) await f.close();
			pending.resolve();
			await closing;
			expect(f.options.advance).not.toHaveBeenCalled();
			f.controller.dispose();
		}
	},
);
it("a failed review-close save keeps the lesson and reports an error without retry", async () => {
	const f = reviewFixture();
	f.options.flush.mockRejectedValue(new Error("Failed save"));
	await f.controller.ended();
	await f.close();
	await f.close();
	expect(f.options.advance).not.toHaveBeenCalled();
	expect(f.options.flush).toHaveBeenCalledOnce();
	expect(f.options.failed).toHaveBeenCalledOnce();
});
it("a stale review close cannot advance a later replay's review", async () => {
	const f = fixture();
	const closes: (() => Promise<void>)[] = [];
	const controller = createAutoAdvance({
		...f.options,
		review: {
			canOpen: () => true,
			open: async (_current, closed) => {
				closes.push(closed);
			},
		},
	});
	await controller.ended();
	controller.reset();
	await controller.ended();
	await closes[0]();
	expect(f.options.flush).not.toHaveBeenCalled();
	await closes[1]();
	expect(f.options.advance).toHaveBeenCalledOnce();
});
it.each(["replay", "hide", "unmount", "blocked"])(
	"invalidates pending fullscreen-exit review on %s",
	async (reason) => {
		const f = fixture(),
			pending = deferred(),
			opened = vi.fn();
		let eligible = true;
		const controller = createAutoAdvance({
			...f.options,
			review: {
				canOpen: () => eligible,
				open: async (current) => {
					await pending.promise;
					if (current()) opened();
				},
			},
		});
		const ending = controller.ended();
		if (reason === "replay") controller.reset();
		else if (reason === "unmount") controller.dispose();
		else if (reason === "hide") controller.cancel();
		else eligible = false;
		pending.resolve();
		await ending;
		expect(opened).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(6000);
		expect(f.options.advance).not.toHaveBeenCalled();
		controller.dispose();
	},
);
it("does not auto-open cards which arrive after ended or after a blocked end", async () => {
	for (const blocked of [false, true]) {
		const f = fixture(),
			open = vi.fn(async () => {});
		let available = false;
		f.options.canAdvance.mockReturnValue(!blocked);
		const controller = createAutoAdvance({
			...f.options,
			review: { canOpen: () => available, open },
		});
		await controller.ended();
		available = true;
		await controller.ended();
		expect(open).not.toHaveBeenCalled();
		controller.dispose();
	}
});
it("clicking advances immediately after pending saves settle, exactly once", async () => {
	const f = fixture();
	const pending = deferred();
	f.options.flush.mockReturnValue(pending.promise);
	await f.controller.ended();
	await vi.advanceTimersByTimeAsync(1000);
	const clicked = f.controller.advanceNow();
	await f.controller.advanceNow();
	expect(f.options.flush).toHaveBeenCalledOnce();
	expect(f.options.changed).toHaveBeenLastCalledWith({
		seconds: 0,
		flushing: true,
	});
	expect(f.options.advance).not.toHaveBeenCalled();
	pending.resolve();
	await clicked;
	expect(f.options.advance).toHaveBeenCalledOnce();
	expect(f.options.flush).toHaveBeenCalledBefore(f.options.advance);
	await vi.advanceTimersByTimeAsync(6000);
	expect(f.options.advance).toHaveBeenCalledOnce();
});
it("Cancel prevents immediate advance, including while a click is flushing saves", async () => {
	for (const flushing of [false, true]) {
		const f = fixture();
		const pending = deferred();
		f.options.flush.mockReturnValue(pending.promise);
		await f.controller.ended();
		const clicked = flushing ? f.controller.advanceNow() : Promise.resolve();
		f.controller.cancel();
		await f.controller.advanceNow();
		pending.resolve();
		await clicked;
		await vi.advanceTimersByTimeAsync(6000);
		expect(f.options.advance).not.toHaveBeenCalled();
	}
});
it("immediate advance respects target availability and failed saves", async () => {
	const blocked = fixture();
	await blocked.controller.advanceNow();
	expect(blocked.options.flush).not.toHaveBeenCalled();
	await blocked.controller.ended();
	blocked.options.canAdvance.mockReturnValue(false);
	await blocked.controller.advanceNow();
	expect(blocked.options.flush).not.toHaveBeenCalled();
	expect(blocked.options.advance).not.toHaveBeenCalled();
	const failed = fixture();
	await failed.controller.ended();
	failed.options.flush.mockRejectedValue(new Error("Save failed"));
	await failed.controller.advanceNow();
	expect(failed.options.advance).not.toHaveBeenCalled();
	expect(failed.options.failed).toHaveBeenCalledOnce();
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
