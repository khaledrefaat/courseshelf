import { beforeEach, expect, it, vi } from "vitest";
import {
	firstPlay,
	persistCompletion,
	playQuietly,
} from "@/features/course/progressActions";
import { setCompleted, touchLastWatched } from "@/lib/db/progress";

vi.mock("@/lib/db/progress", () => ({
	setCompleted: vi.fn(),
	touchLastWatched: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());
it("updates completion immediately, then persists it", async () => {
	let resolve!: () => void;
	vi.mocked(setCompleted).mockReturnValue(
		new Promise((done) => {
			resolve = done;
		}),
	);
	const apply = vi.fn();
	const save = persistCompletion(1, false, apply);
	expect(apply).toHaveBeenCalledWith(true);
	expect(setCompleted).toHaveBeenCalledWith(1, true);
	resolve();
	await save;
});
it("reverts completion when SQLite rejects the write, including undo", async () => {
	vi.mocked(setCompleted).mockRejectedValue(new Error("DB locked"));
	const apply = vi.fn();
	await expect(persistCompletion(1, true, apply)).rejects.toThrow("DB locked");
	expect(apply.mock.calls).toEqual([[false], [true]]);
});
it("records nothing on open and touches once across pause/play in a visit", async () => {
	vi.mocked(touchLastWatched).mockResolvedValue();
	const record = firstPlay(7);
	expect(touchLastWatched).not.toHaveBeenCalled();
	await record();
	await record();
	expect(touchLastWatched).toHaveBeenCalledTimes(1);
	expect(touchLastWatched).toHaveBeenCalledWith(7);
	await firstPlay(7)();
	expect(touchLastWatched).toHaveBeenCalledTimes(2);
});
it("reports a watch write failure only on the first play, without duplicate writes", async () => {
	vi.mocked(touchLastWatched).mockRejectedValue(new Error("Disk full"));
	const record = firstPlay(7);
	await expect(record()).rejects.toThrow("Disk full");
	await record();
	expect(touchLastWatched).toHaveBeenCalledTimes(1);
});
it("ignores both rejected and synchronously failed autoplay", async () => {
	await expect(
		playQuietly({ play: () => Promise.reject(new Error("NotAllowedError")) }),
	).resolves.toBeUndefined();
	await expect(
		playQuietly({
			play: () => {
				throw new Error("AbortError");
			},
		}),
	).resolves.toBeUndefined();
});
