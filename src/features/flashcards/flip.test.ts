import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFlashcardFlip, FLIP_HALF_MS } from "@/features/flashcards/flip";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function fixture(reduced = false) {
	const options = {
		reducedMotion: () => reduced,
		flip: vi.fn(),
		changed: vi.fn(),
	};
	return { ...options, controller: createFlashcardFlip(options) };
}
it("swaps text once only at the fold midpoint, then returns to a normal scale", async () => {
	const f = fixture();
	f.controller.request();
	expect(f.changed).toHaveBeenLastCalledWith("closing");
	expect(f.flip).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(FLIP_HALF_MS);
	expect(f.flip).toHaveBeenCalledOnce();
	expect(f.changed).toHaveBeenLastCalledWith("opening");
	await vi.advanceTimersByTimeAsync(FLIP_HALF_MS);
	expect(f.changed).toHaveBeenLastCalledWith("idle");
	expect(f.flip).toHaveBeenCalledOnce();
	f.controller.dispose();
});
it("coalesces rapid mouse/keyboard activation during either animation half", async () => {
	const f = fixture();
	f.controller.request();
	f.controller.request();
	await vi.advanceTimersByTimeAsync(FLIP_HALF_MS);
	f.controller.request();
	f.controller.request();
	await vi.advanceTimersByTimeAsync(FLIP_HALF_MS);
	expect(f.flip).toHaveBeenCalledOnce();
	f.controller.request();
	await vi.advanceTimersByTimeAsync(FLIP_HALF_MS * 2);
	expect(f.flip).toHaveBeenCalledTimes(2);
	f.controller.dispose();
});
it.each([0, FLIP_HALF_MS])(
	"cancels old-card callbacks when navigating/unmounting after %s ms",
	async (elapsed) => {
		const f = fixture();
		f.controller.request();
		await vi.advanceTimersByTimeAsync(elapsed);
		f.controller.dispose();
		f.flip.mockClear();
		f.changed.mockClear();
		f.controller.request();
		await vi.advanceTimersByTimeAsync(FLIP_HALF_MS * 4);
		expect(f.flip).not.toHaveBeenCalled();
		expect(f.changed).not.toHaveBeenCalled();
	},
);
it("switches immediately without timers or motion when reduced motion is requested", () => {
	const f = fixture(true);
	f.controller.request();
	expect(f.flip).toHaveBeenCalledOnce();
	expect(f.changed).not.toHaveBeenCalled();
	expect(vi.getTimerCount()).toBe(0);
	f.controller.dispose();
});
it("does not schedule an unfold if the midpoint callback removes the review", async () => {
	const changed = vi.fn();
	const controller = createFlashcardFlip({
		reducedMotion: () => false,
		changed,
		flip: () => controller.dispose(),
	});
	controller.request();
	await vi.advanceTimersByTimeAsync(FLIP_HALF_MS * 2);
	expect(changed.mock.calls).toEqual([["closing"]]);
	expect(vi.getTimerCount()).toBe(0);
});
