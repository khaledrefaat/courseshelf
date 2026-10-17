import { readFile } from "@tauri-apps/plugin-fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadCover, retainCoverCache } from "@/features/library/coverCache";

vi.mock("@tauri-apps/api/path", () => ({
	appDataDir: async () => "/app/data",
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
	readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));
let release: () => void;
beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:cover");
	vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
	release = retainCoverCache();
});
afterEach(() => {
	release();
	vi.runAllTimers();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

it("shares reads and URLs across cards, filtering and Strict Mode remounts", async () => {
	expect(await loadCover("one.png")).toBe("blob:cover");
	expect(await loadCover("one.png")).toBe("blob:cover");
	expect(readFile).toHaveBeenCalledTimes(1);
	release();
	release = retainCoverCache();
	vi.runAllTimers();
	expect(URL.revokeObjectURL).not.toHaveBeenCalled();
	expect(await loadCover("one.png")).toBe("blob:cover");
	release();
	release = () => {};
	vi.runAllTimers();
	expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:cover");
});
it("rejects paths outside app covers and unsupported file types", async () => {
	for (const path of [
		"/etc/passwd",
		"../one.png",
		"covers/../../one.png",
		"script.svg",
	])
		expect(await loadCover(path)).toBeNull();
	expect(readFile).not.toHaveBeenCalled();
});
it("caches failures without repeated reads", async () => {
	vi.mocked(readFile).mockRejectedValueOnce(new Error("Missing"));
	expect(await loadCover("gone.jpg")).toBeNull();
	expect(await loadCover("gone.jpg")).toBeNull();
	expect(readFile).toHaveBeenCalledTimes(1);
});
