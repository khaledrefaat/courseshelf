import { afterEach, expect, it, vi } from "vitest";
import {
	playerDoubleClick,
	WINDOWS_PICTURE_CLICK_DELAY,
	windowsPictureClicks,
} from "@/features/course/playerDoubleClick";

function fixture() {
	const video = Object.assign(new EventTarget(), {
		controls: true,
		paused: false,
		ended: false,
		error: null,
		play: vi.fn(async () => {}),
		pause: vi.fn(),
		getBoundingClientRect: () => ({
			top: 20,
			bottom: 420,
			left: 10,
			right: 810,
		}),
	});
	const event = {
		detail: 2,
		target: video as EventTarget,
		button: 0,
		defaultPrevented: false,
		ctrlKey: false,
		altKey: false,
		metaKey: false,
		shiftKey: false,
		clientX: 400,
		clientY: 200,
		preventDefault: vi.fn(),
		stopImmediatePropagation: vi.fn(),
	};
	return { video, event, toggle: vi.fn() };
}

function windowsFixture() {
	vi.useFakeTimers();
	const f = fixture();
	const current: { video: typeof f.video | null } = { video: f.video };
	const blocked = vi.fn(() => false);
	const controller = windowsPictureClicks({
		video: () => current.video,
		blocked,
		toggleFullscreen: f.toggle,
	});
	return {
		...f,
		current,
		blocked,
		cancel: controller.cancel,
		click: (detail: number) => controller.click({ ...f.event, detail }),
	};
}

afterEach(() => vi.useRealTimers());

it("consumes a picture double-click and uses the existing fullscreen toggle once", () => {
	const f = fixture();
	playerDoubleClick(f.event, f.video, false, f.toggle);
	expect(f.toggle).toHaveBeenCalledOnce();
	expect(f.event.preventDefault).toHaveBeenCalledOnce();
	expect(f.event.stopImmediatePropagation).toHaveBeenCalledOnce();
	playerDoubleClick(f.event, f.video, false, f.toggle);
	expect(f.toggle).toHaveBeenCalledTimes(2); // A second double-click exits via the same controller.
});

it.each([false, true])(
	"Windows double-click enters and exits fullscreen without changing playback (paused=%s)",
	(paused) => {
		const f = windowsFixture();
		f.video.paused = paused;
		for (const count of [1, 2]) {
			f.click(1);
			expect(f.toggle).toHaveBeenCalledTimes(count - 1);
			vi.advanceTimersByTime(WINDOWS_PICTURE_CLICK_DELAY - 1);
			f.click(2);
			expect(f.toggle).toHaveBeenCalledTimes(count);
			vi.advanceTimersByTime(WINDOWS_PICTURE_CLICK_DELAY);
		}
		expect(f.event.preventDefault).toHaveBeenCalledTimes(4);
		expect(f.event.stopImmediatePropagation).toHaveBeenCalledTimes(4);
		expect(f.video.play).not.toHaveBeenCalled();
		expect(f.video.pause).not.toHaveBeenCalled();
	},
);

it.each([false, true])(
	"a single Windows picture click toggles playback after the delay (paused=%s)",
	(paused) => {
		const f = windowsFixture();
		f.video.paused = paused;
		f.click(1);
		expect(f.video.play).not.toHaveBeenCalled();
		expect(f.video.pause).not.toHaveBeenCalled();
		vi.advanceTimersByTime(WINDOWS_PICTURE_CLICK_DELAY);
		expect(paused ? f.video.play : f.video.pause).toHaveBeenCalledOnce();
		expect(f.toggle).not.toHaveBeenCalled();
		f.click(2); // A late second click cannot turn an executed single click into fullscreen.
		expect(f.toggle).not.toHaveBeenCalled();
	},
);

it.each(["cleanup", "lesson change", "popup", "playback change", "ended"])(
	"drops a pending Windows click on %s",
	(reason) => {
		const f = windowsFixture();
		f.click(1);
		if (reason === "cleanup") f.cancel();
		if (reason === "lesson change") f.current.video = null;
		if (reason === "popup") f.blocked.mockReturnValue(true);
		if (reason === "playback change") f.video.paused = true;
		if (reason === "ended") f.video.ended = true;
		vi.advanceTimersByTime(WINDOWS_PICTURE_CLICK_DELAY);
		expect(f.video.play).not.toHaveBeenCalled();
		expect(f.video.pause).not.toHaveBeenCalled();
	},
);

it("leaves native Windows control-strip clicks alone", () => {
	const f = windowsFixture();
	f.event.clientY = 400;
	f.click(1);
	f.click(2);
	vi.advanceTimersByTime(WINDOWS_PICTURE_CLICK_DELAY);
	expect(f.toggle).not.toHaveBeenCalled();
	expect(f.event.preventDefault).not.toHaveBeenCalled();
	expect(f.video.pause).not.toHaveBeenCalled();
});

it.each([
	"controls",
	"overlay",
	"popup",
	"modifier",
	"secondary",
	"prevented",
	"outside",
	"no-video",
])("leaves %s gestures untouched", (kind) => {
	const f = fixture();
	if (kind === "controls") f.event.clientY = 400;
	if (kind === "overlay") f.event.target = new EventTarget();
	if (kind === "modifier") f.event.ctrlKey = true;
	if (kind === "secondary") f.event.button = 2;
	if (kind === "prevented") f.event.defaultPrevented = true;
	if (kind === "outside") f.event.clientX = 900;
	playerDoubleClick(
		f.event,
		kind === "no-video" ? null : f.video,
		kind === "popup",
		f.toggle,
	);
	expect(f.toggle).not.toHaveBeenCalled();
	expect(f.event.preventDefault).not.toHaveBeenCalled();
});
