import { expect, it, vi } from "vitest";
import {
	manage,
	pauseCourse,
	registerManagedPlayer,
} from "@/features/course-management/state";

it("blocks conflicting operations, releases the lock after failure, and pauses only the selected course", async () => {
	let release!: () => void;
	const running = manage(
		() =>
			new Promise<void>((resolve) => {
				release = resolve;
			}),
	);
	await expect(manage(async () => {})).rejects.toThrow(
		"Another course operation",
	);
	release();
	await running;
	await expect(
		manage(async () => {
			throw new Error("failed");
		}),
	).rejects.toThrow("failed");
	await manage(async () => {});
	const first = vi.fn(),
		second = vi.fn();
	const unlisten = registerManagedPlayer(1, first),
		other = registerManagedPlayer(2, second);
	pauseCourse(1);
	expect(first).toHaveBeenCalledOnce();
	expect(second).not.toHaveBeenCalled();
	unlisten();
	other();
});
