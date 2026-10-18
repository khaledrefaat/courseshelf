import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { scheduleStartupReady } from "@/lib/startupReady";

function fixture() {
	let next = 0;
	const callbacks = new Map<number, FrameRequestCallback>();
	const frames = {
		requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
			callbacks.set(++next, callback);
			return next;
		}),
		cancelAnimationFrame: vi.fn((id: number) => {
			callbacks.delete(id);
		}),
	};
	const notify = vi.fn(async () => {});
	return {
		frames,
		notify,
		start: () => scheduleStartupReady(notify, frames),
		paint() {
			const batch = [...callbacks.values()];
			callbacks.clear();
			for (const callback of batch) callback(0);
		},
	};
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("signals after the shell has had two frame opportunities, without waiting for database/registration", async () => {
	const f = fixture();
	f.start();
	expect(f.notify).not.toHaveBeenCalled();
	f.paint();
	await Promise.resolve();
	expect(f.notify).not.toHaveBeenCalled();
	f.paint();
	await vi.advanceTimersByTimeAsync(0);
	expect(f.notify).toHaveBeenCalledOnce();
	await vi.advanceTimersByTimeAsync(1000);
	expect(f.notify).toHaveBeenCalledOnce();
});

it("reveals after 200ms if hidden WebView2 never schedules a frame", async () => {
	const f = fixture();
	f.start();
	await vi.advanceTimersByTimeAsync(199);
	expect(f.notify).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(1);
	expect(f.notify).toHaveBeenCalledOnce();
	f.paint();
	await vi.advanceTimersByTimeAsync(1000);
	expect(f.notify).toHaveBeenCalledOnce();
});

it("Strict Mode cleanup cancels the old signal and remount sends just once", async () => {
	const f = fixture();
	const cleanup = f.start();
	f.paint();
	cleanup();
	const stop = f.start();
	f.paint();
	f.paint();
	await vi.advanceTimersByTimeAsync(1000);
	expect(f.notify).toHaveBeenCalledOnce();
	stop();
});

it("cleanup before mounting completes never sends a stale signal", async () => {
	const f = fixture();
	const cleanup = f.start();
	cleanup();
	f.paint();
	await vi.advanceTimersByTimeAsync(1000);
	expect(f.notify).not.toHaveBeenCalled();
});

it.each(["reject", "throw"])(
	"handles an IPC %s so the native fallback can reveal independently",
	async (kind) => {
		const f = fixture();
		if (kind === "reject")
			f.notify.mockRejectedValue(new Error("IPC unavailable"));
		else
			f.notify.mockImplementation(() => {
				throw new Error("IPC unavailable");
			});
		f.start();
		await vi.advanceTimersByTimeAsync(1000);
		expect(f.notify).toHaveBeenCalledOnce();
	},
);
