import { expect, it, vi } from "vitest";
import { createNativePickerGate } from "@/features/library/add-course/nativePicker";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

it("suspends the modal and settles before opening, then restores after closing", async () => {
	const events: string[] = [];
	const gate = createNativePickerGate(async () => {
		events.push("settle");
	});
	const result = await gate.run(
		(active) => events.push(active ? "suspend" : "restore"),
		async () => {
			events.push("pick");
			return "/course";
		},
	);
	expect(result).toBe("/course");
	expect(events).toEqual(["suspend", "settle", "pick", "settle", "restore"]);
	expect(gate.isBusy()).toBe(false);
});

it.each(["folder", "cover"])(
	"blocks a second picker while the %s picker is pending, including setup and teardown",
	async () => {
		const opening = deferred<void>();
		const closing = deferred<void>();
		const picked = deferred<string | null>();
		const settle = vi
			.fn()
			.mockReturnValueOnce(opening.promise)
			.mockReturnValueOnce(closing.promise);
		const gate = createNativePickerGate(settle);
		const active = vi.fn();
		const pick = vi.fn(() => picked.promise);
		const other = vi.fn();
		const first = gate.run(active, pick);
		expect(gate.isBusy()).toBe(true);
		await expect(gate.run(active, other)).rejects.toThrow("already open");
		expect(pick).not.toHaveBeenCalled();
		opening.resolve();
		await vi.waitFor(() => expect(pick).toHaveBeenCalledOnce());
		await expect(gate.run(active, other)).rejects.toThrow("already open");
		picked.resolve("/chosen");
		await vi.waitFor(() => expect(settle).toHaveBeenCalledTimes(2));
		await expect(gate.run(active, other)).rejects.toThrow("already open");
		closing.resolve();
		expect(await first).toBe("/chosen");
		expect(other).not.toHaveBeenCalled();
		expect(active.mock.calls).toEqual([[true], [false]]);
		expect(gate.isBusy()).toBe(false);
	},
);

it("restores modal state on cancellation and permits the next picker", async () => {
	const gate = createNativePickerGate(async () => {});
	const active = vi.fn();
	expect(await gate.run(active, async () => null)).toBeNull();
	expect(active.mock.calls).toEqual([[true], [false]]);
	expect(await gate.run(active, async () => "/image.png")).toBe("/image.png");
});

it("restores modal state after a native error and permits retry", async () => {
	const gate = createNativePickerGate(async () => {});
	const active = vi.fn();
	await expect(
		gate.run(active, async () => {
			throw new Error("Native failure");
		}),
	).rejects.toThrow("Native failure");
	expect(active.mock.calls).toEqual([[true], [false]]);
	expect(gate.isBusy()).toBe(false);
	expect(await gate.run(active, async () => "/course")).toBe("/course");
});
