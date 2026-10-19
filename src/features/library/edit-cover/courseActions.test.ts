import { remove } from "@tauri-apps/plugin-fs";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/features/course/subtitleGeneration", () => ({
	allowSubtitleGeneration: vi.fn(),
	cleanupGeneratedSubtitles: vi.fn(async () => null),
	prepareSubtitleRemoval: vi.fn(async () => []),
}));

import { writeCourseCover } from "@/features/library/add-course/covers";
import {
	deleteCourseFromLibrary,
	managedCoverPath,
	updateCourseCover,
} from "@/features/library/edit-cover/courseActions";
import * as courses from "@/lib/db/courses";

vi.mock("@tauri-apps/api/path", () => ({
	appDataDir: async () => "/app/data",
}));
vi.mock("@tauri-apps/plugin-fs", () => ({ remove: vi.fn() }));
vi.mock("@/features/library/add-course/covers", () => ({
	writeCourseCover: vi.fn(),
}));
vi.mock("@/lib/db/courses", () => ({
	getById: vi.fn(),
	list: vi.fn(),
	updateCover: vi.fn(),
	delete: vi.fn(),
}));
const name = "7-12345678-1234-1234-1234-123456789abc.jpg";
const old = `/app/data/covers/${name}`;
const newPath = "/app/data/covers/7-12345678-1234-1234-1234-123456789def.png";
const course = {
	id: 7,
	title: "Course",
	root_path: "/videos/never-delete",
	cover_path: old,
	created_at: "",
};
const cover = { kind: "png" as const, bytes: new Uint8Array([1]) };
beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(courses.getById).mockResolvedValue({ ...course });
	vi.mocked(courses.list).mockResolvedValue([course]);
	vi.mocked(writeCourseCover).mockResolvedValue(newPath);
});
it("only recognizes app-managed UUID covers for this course", () => {
	for (const path of [old, `covers/${name}`, name])
		expect(managedCoverPath(7, path, "/app/data")).toBe(old);
	for (const path of [
		"/videos/cover.jpg",
		`/app/data/covers/../${name}`,
		`../covers/${name}`,
		old.replace("7-", "8-"),
		"legacy.jpg",
		`${old}/child`,
		old.replace(".jpg", ".svg"),
	])
		expect(managedCoverPath(7, path, "/app/data")).toBeNull();
});
it("saves replacement before deleting the old app-owned cover", async () => {
	expect(await updateCourseCover(7, old, cover)).toEqual({
		path: newPath,
		warning: null,
	});
	expect(writeCourseCover).toHaveBeenCalledWith(7, cover);
	expect(remove).toHaveBeenCalledWith(old);
	expect(vi.mocked(writeCourseCover).mock.invocationCallOrder[0]).toBeLessThan(
		vi.mocked(remove).mock.invocationCallOrder[0],
	);
});
it("recognizes Windows managed covers but never outside paths, traversal or another course", () => {
	const root = "C:\\Users\\Khaled\\AppData\\Roaming\\com.khaled.courseshelf";
	const expected = `${root}\\covers\\${name}`;
	for (const path of [
		expected,
		`covers\\${name}`,
		name,
		expected.replace(/\\/g, "/"),
	])
		expect(managedCoverPath(7, path, root)).toBe(expected);
	for (const path of [
		`${root}\\covers\\..\\${name}`,
		`D:\\courses\\${name}`,
		`${expected}:stream`,
		expected.replace("7-", "8-"),
		`${root}\\covers\\sub\\${name}`,
	])
		expect(managedCoverPath(7, path, root)).toBeNull();
});
it("preserves the previous file when saving a new cover fails", async () => {
	vi.mocked(writeCourseCover).mockRejectedValue(
		new Error("The cover wasn't saved: DB locked"),
	);
	await expect(updateCourseCover(7, old, cover)).rejects.toThrow("DB locked");
	expect(remove).not.toHaveBeenCalled();
});
it("removes a cover by clearing its DB reference first", async () => {
	expect(await updateCourseCover(7, old, null)).toEqual({
		path: null,
		warning: null,
	});
	expect(courses.updateCover).toHaveBeenCalledWith(7, null);
	expect(
		vi.mocked(courses.updateCover).mock.invocationCallOrder[0],
	).toBeLessThan(vi.mocked(remove).mock.invocationCallOrder[0]);
});
it("does not delete any file if clearing the DB reference fails", async () => {
	vi.mocked(courses.updateCover).mockRejectedValue(new Error("DB locked"));
	await expect(updateCourseCover(7, old, null)).rejects.toThrow("DB locked");
	expect(remove).not.toHaveBeenCalled();
});
it("keeps shared covers and external/legacy images intact", async () => {
	vi.mocked(courses.list).mockResolvedValue([course, { ...course, id: 8 }]);
	await updateCourseCover(7, old, cover);
	expect(remove).not.toHaveBeenCalled();
	vi.mocked(courses.getById).mockResolvedValue({
		...course,
		cover_path: "/original/image.jpg",
	});
	await updateCourseCover(7, "/original/image.jpg", cover);
	expect(remove).not.toHaveBeenCalled();
});
it("reports old-file cleanup failure as a warning after a successful update", async () => {
	vi.mocked(remove).mockRejectedValue(new Error("Permission denied"));
	expect(await updateCourseCover(7, old, cover)).toEqual({
		path: newPath,
		warning: expect.stringContaining("Permission denied"),
	});
});
it("rejects a stale edit or unknown course before writing", async () => {
	await expect(updateCourseCover(7, null, cover)).rejects.toThrow(
		"cover changed",
	);
	expect(writeCourseCover).not.toHaveBeenCalled();
	vi.mocked(courses.getById).mockResolvedValue(null);
	await expect(updateCourseCover(7, old, cover)).rejects.toThrow(
		"no longer exists",
	);
});
it("deletes the course before its own thumbnail, never its video folder", async () => {
	expect(await deleteCourseFromLibrary(7)).toBeNull();
	expect(courses.delete).toHaveBeenCalledWith(7);
	expect(remove).toHaveBeenCalledExactlyOnceWith(old);
	expect(vi.mocked(courses.delete).mock.invocationCallOrder[0]).toBeLessThan(
		vi.mocked(remove).mock.invocationCallOrder[0],
	);
});
it("preserves cover files if course deletion fails", async () => {
	vi.mocked(courses.delete).mockRejectedValue(new Error("DB locked"));
	await expect(deleteCourseFromLibrary(7)).rejects.toThrow("DB locked");
	expect(remove).not.toHaveBeenCalled();
});
it("reports cover cleanup failure without pretending the deleted course still exists", async () => {
	vi.mocked(remove).mockRejectedValue(new Error("Read-only disk"));
	expect(await deleteCourseFromLibrary(7)).toContain("Course deleted, but");
});
it("prevents edit/delete overlap for the same course", async () => {
	let resolve!: (path: string) => void;
	vi.mocked(writeCourseCover).mockReturnValue(
		new Promise((done) => {
			resolve = done;
		}),
	);
	const edit = updateCourseCover(7, old, cover);
	await vi.waitFor(() => expect(writeCourseCover).toHaveBeenCalled());
	await expect(deleteCourseFromLibrary(7)).rejects.toThrow(
		"already being updated",
	);
	resolve(newPath);
	await edit;
	expect(courses.delete).not.toHaveBeenCalled();
});
