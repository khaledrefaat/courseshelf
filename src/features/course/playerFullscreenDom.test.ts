import { afterEach, describe, expect, it, vi } from "vitest";
import { playerFullscreen } from "@/features/course/playerFullscreen";
import { fullscreenPort } from "@/features/course/playerFullscreenDom";

function fixture() {
	const doc = Object.assign(new EventTarget(), {
		fullscreenEnabled: true,
		fullscreenElement: null as unknown,
		webkitFullscreenElement: null as unknown,
		exitFullscreen: vi.fn(async () => {
			doc.fullscreenElement = null;
			doc.dispatchEvent(new Event("fullscreenchange"));
		}),
	});
	const wrapper = {
		ownerDocument: doc,
		requestFullscreen: vi.fn(async () => {
			doc.fullscreenElement = wrapper;
			doc.dispatchEvent(new Event("fullscreenchange"));
		}),
	};
	const video = {
		webkitDisplayingFullscreen: false,
		webkitExitFullscreen: vi.fn(() => {
			video.webkitDisplayingFullscreen = false;
		}),
	};
	const window = {
		isFullscreen: vi.fn(async () => false),
		setFullscreen: vi.fn(async (_value: boolean) => {}),
	};
	return {
		doc,
		wrapper,
		video,
		window,
		port: fullscreenPort(
			wrapper as unknown as HTMLElement,
			() => video as unknown as HTMLVideoElement,
			window,
		),
	};
}
afterEach(() => vi.useRealTimers());

describe("browser fullscreen adapter", () => {
	it("requests the wrapper directly from the gesture and confirms actual fullscreen state", async () => {
		const f = fixture();
		const request = f.port.requestWrapper();
		expect(f.wrapper.requestFullscreen).toHaveBeenCalledOnce();
		await request;
		expect(f.port.elementMode()).toBe("wrapper");
		await f.port.exitElement();
		expect(f.port.elementMode()).toBeNull();
	});
	it("rejects when fullscreenEnabled is false and uses the window fallback automatically", async () => {
		const f = fixture();
		f.doc.fullscreenEnabled = false;
		const controller = playerFullscreen(f.port, vi.fn(), vi.fn());
		await controller.toggle();
		expect(f.wrapper.requestFullscreen).not.toHaveBeenCalled();
		expect(f.window.isFullscreen).toHaveBeenCalledBefore(
			f.window.setFullscreen,
		);
		expect(f.window.setFullscreen).toHaveBeenCalledWith(true);
		await controller.dispose();
		expect(f.window.setFullscreen).toHaveBeenLastCalledWith(false);
	});
	it("uses prefixed WebKit wrapper requests returning void and confirms their event", async () => {
		const f = fixture();
		const prefixed = Object.assign({}, f.wrapper, {
			requestFullscreen: undefined,
			webkitRequestFullscreen: vi.fn(() => {
				f.doc.webkitFullscreenElement = prefixed;
				f.doc.dispatchEvent(new Event("webkitfullscreenchange"));
			}),
		});
		const port = fullscreenPort(
			prefixed as unknown as HTMLElement,
			() => null,
			f.window,
		);
		await port.requestWrapper();
		expect(port.elementMode()).toBe("wrapper");
	});
	it("falls back after a rejected native promise", async () => {
		const f = fixture();
		f.wrapper.requestFullscreen.mockRejectedValueOnce(
			new Error("NotAllowedError"),
		);
		const controller = playerFullscreen(f.port, vi.fn(), vi.fn());
		await controller.toggle();
		expect(f.window.setFullscreen).toHaveBeenCalledWith(true);
		await controller.dispose();
	});
	it("bounds a silent/void request and falls back instead of leaving entry stuck", async () => {
		vi.useFakeTimers();
		const f = fixture();
		f.wrapper.requestFullscreen.mockImplementationOnce(async () => {});
		const controller = playerFullscreen(f.port, vi.fn(), vi.fn());
		const pending = controller.toggle();
		await vi.advanceTimersByTimeAsync(1200);
		await pending;
		expect(f.window.setFullscreen).toHaveBeenCalledWith(true);
		await controller.dispose();
	});
	it("recognizes both standard video-element fullscreen and WebKit's native media mode", async () => {
		const f = fixture();
		f.doc.fullscreenElement = f.video;
		expect(f.port.elementMode()).toBe("native");
		await f.port.exitElement();
		f.video.webkitDisplayingFullscreen = true;
		expect(f.port.elementMode()).toBe("native");
		await f.port.exitElement();
		expect(f.video.webkitExitFullscreen).toHaveBeenCalledOnce();
		expect(f.port.elementMode()).toBeNull();
	});
});
