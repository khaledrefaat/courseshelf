import { invoke } from "@tauri-apps/api/core";
import { beforeEach, expect, it, vi } from "vitest";
import { findDuplicate } from "@/features/library/add-course/folders";
import { list } from "@/lib/db/courses";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/lib/db/courses", () => ({ list: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
it("detects a legacy non-canonical root by canonicalizing it, without rewriting it", async () => {
	vi.mocked(list).mockResolvedValue([
		{
			id: 1,
			title: "Legacy",
			root_path: "/alias/Course/../Course/",
			cover_path: null,
			created_at: "",
		},
	]);
	vi.mocked(invoke).mockResolvedValue("/real/Course");
	expect(await findDuplicate("/real/Course")).toBe(true);
	expect(invoke).toHaveBeenCalledWith("canonicalize_course_root", {
		root: "/alias/Course/../Course/",
	});
});
it("recognizes already-canonical roots without another lookup", async () => {
	vi.mocked(list).mockResolvedValue([
		{
			id: 1,
			title: "Course",
			root_path: "/real/Course",
			cover_path: null,
			created_at: "",
		},
	]);
	vi.mocked(invoke).mockResolvedValue("/real/Course");
	expect(await findDuplicate("/real/Course")).toBe(true);
	expect(invoke).toHaveBeenCalledTimes(1);
});
it("does not silently accept an unverifiable legacy root", async () => {
	vi.mocked(list).mockResolvedValue([
		{
			id: 1,
			title: "Legacy",
			root_path: "/alias/Course",
			cover_path: null,
			created_at: "",
		},
	]);
	vi.mocked(invoke).mockResolvedValueOnce("/new").mockRejectedValueOnce({
		code: "FOLDER_NOT_AUTHORIZED",
		message: "Re-pick",
	});
	await expect(findDuplicate("/new")).rejects.toThrow("Could not verify");
});
it("does not let a genuinely missing old root block another folder", async () => {
	vi.mocked(list).mockResolvedValue([
		{
			id: 1,
			title: "Missing",
			root_path: "/missing",
			cover_path: null,
			created_at: "",
		},
	]);
	vi.mocked(invoke).mockResolvedValueOnce("/new").mockRejectedValueOnce({
		code: "ROOT_UNREADABLE",
		message: "No such file or directory (os error 2)",
	});
	expect(await findDuplicate("/new")).toBe(false);
});
