import { describe, expect, it, vi } from "vitest";
import {
	focusPlayer,
	playerShortcuts,
	type ShortcutKey,
} from "@/features/course/playerShortcuts";

function keyEvent(key: string, extra: Partial<ShortcutKey> = {}): ShortcutKey {
	return {
		key,
		code: key === " " ? "Space" : key,
		repeat: false,
		isComposing: false,
		ctrlKey: false,
		altKey: false,
		metaKey: false,
		defaultPrevented: false,
		preventDefault() {
			this.defaultPrevented = true;
		},
		stopImmediatePropagation: vi.fn(),
		...extra,
	};
}
const allowed = { blocked: false, activationTarget: false };
function fixture() {
	const video = {
		currentTime: 25,
		duration: 100,
		volume: 0.7,
		muted: false,
		paused: true,
		play: vi.fn(async () => {
			video.paused = false;
		}),
		pause: vi.fn(() => {
			video.paused = true;
		}),
	};
	let ready = true;
	const options = {
		video: () => video,
		canSeek: () => ready,
		focus: vi.fn(),
		toggleFullscreen: vi.fn(),
		exitFullscreen: vi.fn(),
		isFullscreen: () => true,
		indicate: vi.fn(),
	};
	return {
		video,
		options,
		controls: playerShortcuts(options),
		notReady: () => {
			ready = false;
		},
	};
}

describe("player shortcuts", () => {
	it("one Space consumes keydown/keypress/keyup and a synthetic click; real clicks remain native", () => {
		const f = fixture();
		for (const type of ["keydown", "keypress", "keyup", "click"]) {
			const event = keyEvent(" ");
			if (type === "keydown") f.controls.keydown(event, allowed);
			if (type === "keypress") f.controls.spaceContinuation(event, false);
			if (type === "keyup") f.controls.spaceContinuation(event, true);
			if (type === "click") {
				const click = { ...event, detail: 0 };
				f.controls.click(click, true);
				expect(click.defaultPrevented).toBe(true);
				if (!click.defaultPrevented) f.video.pause();
			}
			// A native default action would toggle again only if this wasn't cancelled.
			if (type !== "click") expect(event.defaultPrevented).toBe(true);
			if (type !== "click" && !event.defaultPrevented) f.video.pause();
		}
		expect(f.video.play).toHaveBeenCalledOnce();
		expect(f.video.pause).not.toHaveBeenCalled();
		const pointer = {
			detail: 1,
			preventDefault: vi.fn(),
			stopImmediatePropagation: vi.fn(),
		};
		f.controls.click(pointer, true);
		expect(pointer.preventDefault).not.toHaveBeenCalled();
		f.controls.keydown(keyEvent(" "), allowed);
		expect(f.video.pause).toHaveBeenCalledOnce();
	});
	it("does not consume Space on buttons/links, nor their keyup/click activation", () => {
		const f = fixture();
		const event = keyEvent(" ");
		f.controls.keydown(event, { ...allowed, activationTarget: true });
		f.controls.spaceContinuation(event, true);
		const click = {
			detail: 0,
			preventDefault: vi.fn(),
			stopImmediatePropagation: vi.fn(),
		};
		f.controls.click(click, false);
		expect(event.defaultPrevented).toBe(false);
		expect(click.preventDefault).not.toHaveBeenCalled();
		expect(f.video.play).not.toHaveBeenCalled();
	});
	it("Space repeats do not toggle again", () => {
		const f = fixture();
		f.controls.keydown(keyEvent(" "), allowed);
		f.controls.keydown(keyEvent(" ", { repeat: true }), allowed);
		expect(f.video.play).toHaveBeenCalledOnce();
		expect(f.video.pause).not.toHaveBeenCalled();
	});
	it.each([
		"ctrlKey",
		"altKey",
		"metaKey",
		"isComposing",
		"defaultPrevented",
	] as const)("ignores %s", (field) => {
		const f = fixture();
		f.controls.keydown(keyEvent("ArrowRight", { [field]: true }), allowed);
		expect(f.video.currentTime).toBe(25);
	});
	it("ignores guarded editing, roles and popup contexts", () => {
		const f = fixture();
		for (const key of [" ", "ArrowRight", "ArrowUp", "f", "m", "Escape"])
			f.controls.keydown(keyEvent(key), {
				blocked: true,
				activationTarget: false,
			});
		expect(f.video.play).not.toHaveBeenCalled();
		expect(f.video.currentTime).toBe(25);
		expect(f.video.volume).toBe(0.7);
		expect(f.options.toggleFullscreen).not.toHaveBeenCalled();
	});
	it("seeks once rather than also allowing a native ten-second seek, and clamps both ends", () => {
		const f = fixture();
		const event = keyEvent("ArrowRight");
		f.controls.keydown(event, allowed);
		if (!event.defaultPrevented) f.video.currentTime += 10;
		expect(f.video.currentTime).toBe(35);
		f.video.currentTime = 95;
		f.controls.keydown(keyEvent("ArrowRight"), allowed);
		expect(f.video.currentTime).toBe(100);
		f.video.currentTime = 5;
		f.controls.keydown(keyEvent("ArrowLeft"), allowed);
		expect(f.video.currentTime).toBe(0);
	});
	it("suppresses native seeking too while resume is pending, or duration is invalid", () => {
		const f = fixture();
		f.notReady();
		const event = keyEvent("ArrowRight");
		f.controls.keydown(event, allowed);
		expect(event.defaultPrevented).toBe(true);
		expect(f.video.currentTime).toBe(25);
		const other = fixture();
		other.video.duration = Infinity;
		other.controls.keydown(keyEvent("ArrowRight"), allowed);
		expect(other.video.currentTime).toBe(25);
	});
	it("clamps volume, raises it by ten percent and unmutes when raised", () => {
		const f = fixture();
		f.video.muted = true;
		f.controls.keydown(keyEvent("ArrowUp"), allowed);
		expect(f.video.volume).toBe(0.8);
		expect(f.video.muted).toBe(false);
		f.video.volume = 0.95;
		f.controls.keydown(keyEvent("ArrowUp"), allowed);
		expect(f.video.volume).toBe(1);
		f.video.volume = 0.05;
		f.controls.keydown(keyEvent("ArrowDown"), allowed);
		expect(f.video.volume).toBe(0);
		f.controls.keydown(keyEvent("m"), allowed);
		expect(f.video.muted).toBe(true);
	});
	it("f toggles, Escape exits, and repetition is ignored", () => {
		const f = fixture();
		f.controls.keydown(keyEvent("f"), allowed);
		f.controls.keydown(keyEvent("f", { repeat: true }), allowed);
		f.controls.keydown(keyEvent("Escape"), allowed);
		expect(f.options.toggleFullscreen).toHaveBeenCalledOnce();
		expect(f.options.exitFullscreen).toHaveBeenCalledOnce();
	});
	it("focuses without scroll jumps and catches a blocked play promise", async () => {
		const focus = vi.fn();
		focusPlayer({ focus });
		expect(focus).toHaveBeenCalledWith({ preventScroll: true });
		const f = fixture();
		f.video.play.mockRejectedValueOnce(new Error("NotAllowedError"));
		f.controls.keydown(keyEvent(" "), allowed);
		await Promise.resolve();
		expect(f.options.focus).toHaveBeenCalledOnce();
		expect(f.video.paused).toBe(true);
	});
});
