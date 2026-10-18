/// <reference types="node" />
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join as nodeJoin } from "node:path";
import { appDataDir } from "@tauri-apps/api/path";
import {
	mkdir,
	readFile,
	remove,
	stat,
	writeFile,
} from "@tauri-apps/plugin-fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	readCover,
	saveCover,
	writeCourseCover,
} from "@/features/library/add-course/covers";
import { maxCoverBytes } from "@/features/library/add-course/model";
import { updateCover } from "@/lib/db/courses";

vi.mock("@tauri-apps/api/path", () => ({
	appDataDir: vi.fn(async () => "/app/data"),
	join: async (...parts: string[]) => parts.join("/"),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
	mkdir: vi.fn(),
	readFile: vi.fn(),
	remove: vi.fn(),
	stat: vi.fn(),
	writeFile: vi.fn(),
}));
vi.mock("@/lib/db/courses", () => ({ updateCover: vi.fn() }));
const cover = {
	bytes: new Uint8Array([255, 216, 255, 224]),
	kind: "jpg" as const,
};
beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(appDataDir).mockResolvedValue("/app/data");
	vi.mocked(readFile).mockResolvedValue(cover.bytes);
	vi.mocked(stat).mockResolvedValue({ size: 4, isFile: true } as Awaited<
		ReturnType<typeof stat>
	>);
	vi.spyOn(crypto, "randomUUID").mockReturnValue(
		"12345678-1234-1234-1234-123456789abc",
	);
});
afterEach(() => vi.restoreAllMocks());
it("checks size before reading, rejects oversized images without reading", async () => {
	vi.mocked(stat).mockResolvedValue({
		size: maxCoverBytes + 1,
		isFile: true,
	} as Awaited<ReturnType<typeof stat>>);
	await expect(readCover("/picked/a.png")).rejects.toThrow("10 MB");
	expect(readFile).not.toHaveBeenCalled();
});
it("accepts supported magic bytes, not a disguised SVG named PNG", async () => {
	expect(await readCover("/picked/a.jpeg")).toEqual(cover);
	expect(vi.mocked(stat).mock.invocationCallOrder[0]).toBeLessThan(
		vi.mocked(readFile).mock.invocationCallOrder[0],
	);
	vi.mocked(readFile).mockResolvedValue(
		new TextEncoder().encode("<svg></svg>"),
	);
	await expect(readCover("/picked/a.png")).rejects.toThrow("not a valid PNG");
});
it("rechecks byte length if the image grows after stat", async () => {
	vi.mocked(readFile).mockResolvedValue(new Uint8Array(maxCoverBytes + 1));
	await expect(readCover("/picked/a.jpg")).rejects.toThrow("10 MB");
});
it("removes copied bytes when saving cover_path fails, and reports cleanup failure", async () => {
	vi.mocked(updateCover).mockRejectedValue(new Error("DB failure"));
	vi.mocked(remove).mockRejectedValue(new Error("Disk read-only"));
	const warning = await saveCover(3, cover);
	expect(warning).toContain("cover wasn't saved");
	expect(warning).toContain("DB failure");
	expect(warning).toContain("Cover cleanup also failed");
	expect(warning).toContain("Disk read-only");
	expect(remove).toHaveBeenCalledWith(
		"/app/data/covers/3-12345678-1234-1234-1234-123456789abc.jpg",
	);
});
it("cleans up a partial write but never removes a colliding existing file", async () => {
	vi.mocked(writeFile).mockRejectedValueOnce(new Error("Disk full"));
	expect(await saveCover(3, cover)).toContain("Disk full");
	expect(remove).toHaveBeenCalledTimes(1);
	vi.mocked(remove).mockClear();
	vi.mocked(writeFile).mockRejectedValueOnce(
		new Error("File exists (os error 17)"),
	);
	expect(await saveCover(3, cover)).toContain("File exists");
	expect(remove).not.toHaveBeenCalled();
	expect(updateCover).not.toHaveBeenCalled();
});
it("uses the edit's atomic commit callback and removes only the new copy if that update fails", async () => {
	const commit = vi.fn(async () => {
		throw new Error("title+cover DB update failed");
	});
	await expect(writeCourseCover(3, cover, commit)).rejects.toThrow(
		"title+cover DB update failed",
	);
	expect(updateCover).not.toHaveBeenCalled();
	expect(commit).toHaveBeenCalledWith(
		"/app/data/covers/3-12345678-1234-1234-1234-123456789abc.jpg",
	);
	expect(remove).toHaveBeenCalledWith(
		"/app/data/covers/3-12345678-1234-1234-1234-123456789abc.jpg",
	);
	expect(vi.mocked(writeFile).mock.invocationCallOrder[0]).toBeLessThan(
		commit.mock.invocationCallOrder[0],
	);
});
it.each([80, 183])(
	"never deletes a colliding cover on Windows (OS error %s)",
	async (code) => {
		vi.mocked(writeFile).mockRejectedValue(
			new Error(`Localized Windows error (os error ${code})`),
		);
		expect(await saveCover(3, cover)).toContain(`os error ${code}`);
		expect(remove).not.toHaveBeenCalled();
		expect(updateCover).not.toHaveBeenCalled();
	},
);
it("creates covers and missing app-data parents on a clean install (real filesystem adapter)", async () => {
	mkdirSync(nodeJoin(process.cwd(), "node_modules/.cache"), {
		recursive: true,
	});
	const temporary = mkdtempSync(
		nodeJoin(process.cwd(), "node_modules/.cache/cover-test-"),
	);
	try {
		const root = nodeJoin(temporary, "absent-parent", "app-data");
		vi.mocked(appDataDir).mockResolvedValue(root);
		vi.mocked(mkdir).mockImplementation(async (path, options) => {
			mkdirSync(String(path), { recursive: options?.recursive });
		});
		vi.mocked(writeFile).mockImplementation(async (path, bytes, options) => {
			writeFileSync(String(path), bytes as Uint8Array, {
				flag: options?.createNew ? "wx" : "w",
			});
		});
		expect(existsSync(root)).toBe(false);
		expect(await saveCover(3, cover)).toBeNull();
		expect(mkdir).toHaveBeenCalledWith(`${root}/covers`, { recursive: true });
		const path = vi.mocked(updateCover).mock.calls[0][1];
		expect(Array.from(readFileSync(path as string))).toEqual(
			Array.from(cover.bytes),
		);
		expect(writeFile).toHaveBeenCalledWith(path, cover.bytes, {
			createNew: true,
		});
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
});
