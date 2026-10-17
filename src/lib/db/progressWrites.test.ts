import { expect, it, vi } from "vitest";
import {
	queueProgressWrite,
	waitForProgressWrites,
} from "@/lib/db/progressWrites";

it("serializes per lesson, tracks queued writes before Library reads, and allows other lessons to proceed", async () => {
	let release!: () => void;
	const order: number[] = [];
	const first = queueProgressWrite(1, async () => {
		await new Promise<void>((resolve) => {
			release = resolve;
		});
		order.push(10);
	});
	const second = queueProgressWrite(1, async () => {
		order.push(20);
	});
	const other = queueProgressWrite(2, async () => {
		order.push(30);
	});
	const read = vi.fn();
	const library = waitForProgressWrites().then(read);
	await other;
	expect(order).toEqual([30]);
	expect(read).not.toHaveBeenCalled();
	release();
	await Promise.all([first, second, library]);
	expect(order).toEqual([30, 10, 20]);
	expect(read).toHaveBeenCalledTimes(1);
});
it("does not poison the queue or block reads after a rejected write", async () => {
	const first = queueProgressWrite(1, async () => {
		throw new Error("locked");
	});
	const second = vi.fn(async () => {});
	const next = queueProgressWrite(1, second);
	await expect(first).rejects.toThrow("locked");
	await next;
	await waitForProgressWrites();
	expect(second).toHaveBeenCalledTimes(1);
});
