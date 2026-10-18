import { invoke } from "@tauri-apps/api/core";
import { afterEach, expect, it, vi } from "vitest";
import {
	readWindowFullscreen,
	setWindowFullscreen,
} from "@/features/course/windowFullscreenState";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => {
	vi.useRealTimers();
	vi.mocked(invoke).mockReset();
});

it("detects an OS exit even when Tauri still reports cached fullscreen=true", async () => {
	vi.mocked(invoke).mockResolvedValueOnce(false);
	expect(await readWindowFullscreen({ isFullscreen: async () => true })).toBe(
		false,
	);
	expect(invoke).toHaveBeenCalledWith("actual_window_fullscreen");
});

it("waits for actual GTK confirmation rather than the cached request acknowledgement", async () => {
	vi.useFakeTimers();
	vi.mocked(invoke).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
	const window = {
		isFullscreen: vi.fn(async () => true),
		setFullscreen: vi.fn(async (_value: boolean) => {}),
	};
	const pending = setWindowFullscreen(window, true);
	await vi.advanceTimersByTimeAsync(50);
	await pending;
	expect(window.setFullscreen).toHaveBeenCalledOnce();
	expect(invoke).toHaveBeenCalledTimes(2);
});
it("bounds a refused window transition instead of leaving entry/cleanup stuck", async () => {
	vi.useFakeTimers();
	vi.mocked(invoke).mockResolvedValue(false);
	const window = {
		isFullscreen: async () => true,
		setFullscreen: async (_value: boolean) => {},
	};
	const result = expect(setWindowFullscreen(window, true)).rejects.toThrow(
		"did not confirm",
	);
	await vi.advanceTimersByTimeAsync(1000);
	await result;
});
it("recognizes actual fullscreen despite a stale false cache", async () => {
	vi.mocked(invoke).mockResolvedValueOnce(true);
	expect(await readWindowFullscreen({ isFullscreen: async () => false })).toBe(
		true,
	);
});
it("uses Tauri on non-GTK platforms and does not silently swallow GTK failures", async () => {
	vi.mocked(invoke).mockResolvedValueOnce(null);
	expect(await readWindowFullscreen({ isFullscreen: async () => true })).toBe(
		true,
	);
	vi.mocked(invoke).mockRejectedValueOnce(new Error("No GDK surface"));
	await expect(
		readWindowFullscreen({ isFullscreen: async () => true }),
	).rejects.toThrow("No GDK surface");
});
