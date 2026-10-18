import { describe, expect, it, vi } from "vitest";
import {
	type FullscreenMode,
	playerFullscreen,
} from "@/features/course/playerFullscreen";

function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function fixture(wrapperWorks = true, originallyFullscreen = false) {
	let element: "wrapper" | "native" | null = null;
	const window = {
		fullscreen: originallyFullscreen,
		maximized: true,
		width: 1280,
		height: 800,
	};
	const calls: string[] = [];
	const port = {
		elementMode: () => element,
		requestWrapper: vi.fn(async () => {
			calls.push("wrapper");
			if (!wrapperWorks) throw new Error("Not supported");
			element = "wrapper";
		}),
		exitElement: vi.fn(async () => {
			element = null;
		}),
		isWindowFullscreen: vi.fn(async () => {
			calls.push("read");
			return window.fullscreen;
		}),
		setWindowFullscreen: vi.fn(async (value: boolean) => {
			calls.push(`set:${value}`);
			window.fullscreen = value;
		}),
	};
	const states: FullscreenMode[] = [];
	const error = vi.fn();
	const controller = playerFullscreen(port, (mode) => states.push(mode), error);
	return {
		controller,
		port,
		states,
		error,
		window,
		calls,
		native: () => {
			element = "native";
		},
		nativeExit: () => {
			element = null;
		},
	};
}

describe("player fullscreen", () => {
	it("tries wrapper synchronously before any window query and uses no window IPC on success", async () => {
		const f = fixture();
		const pending = f.controller.toggle();
		expect(f.port.requestWrapper).toHaveBeenCalledOnce();
		expect(f.port.isWindowFullscreen).not.toHaveBeenCalled();
		await pending;
		expect(f.states[f.states.length - 1]).toBe("wrapper");
		await f.controller.toggle();
		expect(f.states[f.states.length - 1]).toBe("none");
		expect(f.port.exitElement).toHaveBeenCalledOnce();
		expect(f.port.setWindowFullscreen).not.toHaveBeenCalled();
	});
	it("falls back automatically, records first, and returns to the maximized window without changing geometry", async () => {
		const f = fixture(false);
		await f.controller.toggle();
		expect(f.calls).toEqual(["wrapper", "read", "set:true"]);
		expect(f.states[f.states.length - 1]).toBe("window");
		await f.controller.exit();
		expect(f.window).toEqual({
			fullscreen: false,
			maximized: true,
			width: 1280,
			height: 800,
		});
		expect(f.calls[f.calls.length - 1]).toBe("set:false");
		expect(f.states[f.states.length - 1]).toBe("none");
	});
	it("preserves a window that was already truly fullscreen before the fallback", async () => {
		const f = fixture(false, true);
		await f.controller.toggle();
		await f.controller.exit();
		expect(f.window.fullscreen).toBe(true);
		expect(f.port.setWindowFullscreen).toHaveBeenLastCalledWith(true);
	});
	it.each(["page leave", "course removal", "unmount"])(
		"restores fallback state on %s disposal without publishing after disposal",
		async () => {
			const f = fixture(false);
			await f.controller.toggle();
			const count = f.states.length;
			await f.controller.dispose();
			expect(f.window.fullscreen).toBe(false);
			expect(f.states).toHaveLength(count);
		},
	);
	it("cancels entry on Escape before a wrapper request resolves", async () => {
		const f = fixture();
		const gate = deferred();
		f.port.requestWrapper.mockImplementationOnce(async () => {
			await gate.promise;
			f.native();
		});
		const entering = f.controller.toggle();
		expect(f.controller.isActive()).toBe(true);
		const exiting = f.controller.exit();
		gate.resolve();
		await Promise.all([entering, exiting]);
		expect(f.port.exitElement).toHaveBeenCalledOnce();
		expect(f.port.setWindowFullscreen).not.toHaveBeenCalled();
		expect(f.states[f.states.length - 1]).toBe("none");
	});
	it("unmount during a pending fallback write waits then restores, without late fullscreen revival", async () => {
		const f = fixture(false);
		const started = deferred();
		const gate = deferred();
		f.port.setWindowFullscreen.mockImplementationOnce(async () => {
			started.resolve();
			await gate.promise;
			f.window.fullscreen = true;
		});
		const entering = f.controller.toggle();
		await started.promise;
		const disposing = f.controller.dispose();
		gate.resolve();
		await Promise.all([entering, disposing]);
		expect(f.window.fullscreen).toBe(false);
		expect(f.port.setWindowFullscreen).toHaveBeenLastCalledWith(false);
		expect(f.states).not.toContain("window");
	});
	it("f a second time during entry cancels rather than entering twice", async () => {
		const f = fixture();
		const gate = deferred();
		f.port.requestWrapper.mockImplementationOnce(async () => {
			await gate.promise;
			f.native();
		});
		const first = f.controller.toggle();
		const second = f.controller.toggle();
		gate.resolve();
		await Promise.all([first, second]);
		expect(f.port.requestWrapper).toHaveBeenCalledOnce();
		expect(f.states[f.states.length - 1]).toBe("none");
	});
	it("tracks native-control fullscreen events and exits that mode with f/Escape", async () => {
		const f = fixture();
		f.native();
		f.controller.syncElement();
		expect(f.states[f.states.length - 1]).toBe("native");
		await f.controller.toggle();
		expect(f.port.exitElement).toHaveBeenCalledOnce();
		f.native();
		f.controller.syncElement();
		await f.controller.exit();
		expect(f.states[f.states.length - 1]).toBe("none");
		f.native();
		f.controller.syncElement();
		f.nativeExit();
		f.controller.syncElement();
		expect(f.states[f.states.length - 1]).toBe("none");
	});
	it("syncs OS fallback exits without fighting the OS, then f can enter again", async () => {
		const f = fixture(false);
		await f.controller.toggle();
		f.window.fullscreen = false;
		await f.controller.syncWindow();
		expect(f.states[f.states.length - 1]).toBe("none");
		expect(f.controller.usesWindow()).toBe(false);
		await f.controller.toggle();
		expect(f.states[f.states.length - 1]).toBe("window");
		await f.controller.dispose();
	});
	it("reports restoration failure and permits retry without losing the original state", async () => {
		const f = fixture(false);
		await f.controller.toggle();
		f.port.setWindowFullscreen.mockRejectedValueOnce(
			new Error("temporary failure"),
		);
		await f.controller.exit();
		expect(f.error).toHaveBeenCalled();
		await f.controller.exit();
		expect(f.window.fullscreen).toBe(false);
	});
	it("f immediately after an OS exit re-enters without waiting for the polling tick", async () => {
		const f = fixture(false);
		await f.controller.toggle();
		f.window.fullscreen = false;
		await f.controller.toggle();
		expect(f.window.fullscreen).toBe(true);
		expect(f.port.requestWrapper).toHaveBeenCalledTimes(2);
		await f.controller.dispose();
	});
});
