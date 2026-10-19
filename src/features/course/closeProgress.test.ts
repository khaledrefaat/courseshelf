import { afterEach, expect, it, vi } from "vitest";
import {
	boundedFlush,
	installCloseFlush,
	registerProgressFlush,
} from "@/features/course/closeProgress";
import { queueProgressWrite } from "@/lib/db/progressWrites";

const closeRequested = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/window", () => ({
	getCurrentWindow: () => ({ onCloseRequested: closeRequested }),
}));

afterEach(() => vi.useRealTimers());
it("cancels subtitle work on close without starving progress flushes or extending the timeout", async () => {
	vi.useFakeTimers();
	let handler!: () => Promise<void>;
	closeRequested.mockImplementationOnce((callback: () => Promise<void>) => {
		handler = callback;
		return Promise.resolve(vi.fn());
	});
	const cancel = vi.fn(() => new Promise<void>(() => {}));
	await installCloseFlush(cancel);
	const flush = vi.fn();
	const unregister = registerProgressFlush(flush);
	const closed = vi.fn();
	const closing = handler().then(closed);
	await vi.advanceTimersByTimeAsync(1);
	expect(cancel).toHaveBeenCalledOnce();
	expect(flush).toHaveBeenCalledOnce();
	expect(closed).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(1999);
	await closing;
	expect(closed).toHaveBeenCalledOnce();
	unregister();
});
it("waits for a successful final flush", async () => {
	let done!: () => void;
	const flush = boundedFlush(
		() =>
			new Promise<void>((resolve) => {
				done = resolve;
			}),
	);
	await Promise.resolve();
	done();
	await expect(flush).resolves.toBeUndefined();
});
it("always proceeds after synchronous errors, rejected saves, or a two-second hung flush", async () => {
	await expect(
		boundedFlush(() => {
			throw new Error("closed DB");
		}),
	).resolves.toBeUndefined();
	await expect(
		boundedFlush(() => Promise.reject(new Error("disk full"))),
	).resolves.toBeUndefined();
	vi.useFakeTimers();
	const closed = vi.fn();
	const result = boundedFlush(() => new Promise(() => {})).then(closed);
	await vi.advanceTimersByTimeAsync(1999);
	expect(closed).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(1);
	await result;
	expect(closed).toHaveBeenCalledTimes(1);
});

it("registers a close handler that flushes active players, awaits queued writes, and cleans up flush callbacks", async () => {
	const unlisten = vi.fn();
	let handler!: () => Promise<void>;
	closeRequested.mockImplementationOnce((callback: () => Promise<void>) => {
		handler = callback;
		return Promise.resolve(unlisten);
	});
	expect(await installCloseFlush()).toBe(unlisten);
	let release!: () => void;
	const flush = vi.fn(() => {
		void queueProgressWrite(
			8,
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
	});
	const unregister = registerProgressFlush(flush);
	const closed = vi.fn();
	const closing = handler().then(closed);
	await Promise.resolve();
	await Promise.resolve();
	expect(flush).toHaveBeenCalledOnce();
	expect(closed).not.toHaveBeenCalled();
	release();
	await closing;
	expect(closed).toHaveBeenCalledOnce();
	unregister();
	await handler();
	expect(flush).toHaveBeenCalledOnce();
});
