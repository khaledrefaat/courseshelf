import { beforeEach, expect, it, vi } from "vitest";
import { flushPendingData } from "@/features/course/closeProgress";
import {
	editCourse,
	previewRelocation,
	relocate,
	removeCourse,
	rescan,
} from "@/features/course-management/actions";
import { writeCourseCover } from "@/features/library/add-course/covers";
import { canonicalizeRoot } from "@/features/library/add-course/folders";
import { cleanupCover } from "@/features/library/edit-cover/courseActions";
import { notesController } from "@/features/notes/store";
import * as courses from "@/lib/db/courses";
import { listAllByCourse } from "@/lib/db/lessons";
import {
	allowLessonWrites,
	discardLessonWrites,
} from "@/lib/db/progressWrites";
import { syncCourse } from "@/lib/db/syncCourse";
import { registerCourseRoot, unregisterCourseRoot } from "@/lib/playback";
import { scanCourse } from "@/lib/scanner/scanCourse";
import { buildCourseStructure } from "@/lib/scanner/structure";

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db/courses", () => ({
	getById: vi.fn(),
	list: vi.fn(),
	updateRoot: vi.fn(),
	updateDetails: vi.fn(),
	delete: vi.fn(),
}));
vi.mock("@/features/course/subtitleGeneration", () => ({
	allowSubtitleGeneration: vi.fn(),
	cancelGeneration: vi.fn(),
	cleanupGeneratedSubtitles: vi.fn(async () => null),
	prepareSubtitleRemoval: vi.fn(async () => []),
}));
vi.mock("@/lib/db/lessons", () => ({ listAllByCourse: vi.fn() }));
vi.mock("@/lib/db/syncCourse", () => ({ syncCourse: vi.fn() }));
vi.mock("@/lib/scanner/scanCourse", () => ({ scanCourse: vi.fn() }));
vi.mock("@/lib/playback", () => ({
	registerCourseRoot: vi.fn(),
	unregisterCourseRoot: vi.fn(),
}));
vi.mock("@/features/library/edit-cover/courseActions", () => ({
	cleanupCover: vi.fn(),
}));
vi.mock("@/features/course/closeProgress", () => ({
	flushPendingData: vi.fn(),
}));
vi.mock("@/features/notes/store", () => ({
	notesController: { discardCourse: vi.fn() },
}));
vi.mock("@/lib/db/progressWrites", () => ({
	discardLessonWrites: vi.fn(),
	allowLessonWrites: vi.fn(),
}));
vi.mock("@/features/library/add-course/covers", () => ({
	writeCourseCover: vi.fn(),
}));
vi.mock("@/features/library/add-course/folders", () => ({
	canonicalizeRoot: vi.fn(),
	errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
const course: courses.Course = {
	id: 1,
	title: "One",
	root_path: "/old",
	cover_path: "/data/covers/old.png",
	created_at: "",
};
const scan = {
	root_path: "/new",
	skipped_symlink_count: 0,
	...buildCourseStructure(["one.mp4", "new.mp4"]),
};
beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(courses.getById).mockResolvedValue(course);
	vi.mocked(courses.list).mockResolvedValue([course]);
	vi.mocked(canonicalizeRoot).mockImplementation(async (path) => path);
	vi.mocked(listAllByCourse).mockResolvedValue([
		{
			id: 10,
			course_id: 1,
			relative_path: "one.mp4",
			title: "One",
			sort_order: 0,
			created_at: "",
			missing_at: null,
		},
	]);
	vi.mocked(scanCourse).mockResolvedValue(scan);
	vi.mocked(registerCourseRoot).mockResolvedValue({
		courseId: 1,
		status: "registered",
		message: "ok",
	});
	vi.mocked(cleanupCover).mockResolvedValue(null);
	vi.mocked(syncCourse).mockResolvedValue({
		ok: true,
		course_id: 1,
		scan,
		added_count: 1,
		missing_count: 0,
		restored_count: 0,
		summary: { completed_count: 0, total_count: 2 },
	});
});
it("removes in order: discard/drain, DB cascade, cover cleanup, unregister", async () => {
	await removeCourse(1);
	expect(discardLessonWrites).toHaveBeenCalledWith([10]);
	expect(notesController.discardCourse).toHaveBeenCalledWith(1);
	expect(
		vi.mocked(discardLessonWrites).mock.invocationCallOrder[0],
	).toBeLessThan(vi.mocked(courses.delete).mock.invocationCallOrder[0]);
	expect(vi.mocked(courses.delete).mock.invocationCallOrder[0]).toBeLessThan(
		vi.mocked(cleanupCover).mock.invocationCallOrder[0],
	);
	expect(vi.mocked(cleanupCover).mock.invocationCallOrder[0]).toBeLessThan(
		vi.mocked(unregisterCourseRoot).mock.invocationCallOrder[0],
	);
});
it("does not touch covers/registration on failed deletion and releases the write block", async () => {
	vi.mocked(courses.delete).mockRejectedValue(new Error("DB locked"));
	await expect(removeCourse(1)).rejects.toThrow("DB locked");
	expect(allowLessonWrites).toHaveBeenCalledWith([10]);
	expect(cleanupCover).not.toHaveBeenCalled();
	expect(unregisterCourseRoot).not.toHaveBeenCalled();
});
it("keeps removal successful if cleanup fails, still unregisters, and reports revocation failure", async () => {
	vi.mocked(cleanupCover).mockResolvedValue("Old cover could not be removed");
	vi.mocked(unregisterCourseRoot).mockRejectedValue(new Error("IPC failed"));
	expect(await removeCourse(1)).toContain("restart Courseshelf");
	expect(unregisterCourseRoot).toHaveBeenCalledWith(1);
});
it("commits edit details through the new-cover callback before old-cover cleanup", async () => {
	vi.mocked(writeCourseCover).mockImplementation(
		async (_id, _cover, commit) => {
			await commit?.("/new.png");
			return "/new.png";
		},
	);
	await editCourse(course, "  Renamed  ", {
		kind: "png",
		bytes: new Uint8Array(),
	});
	expect(courses.updateDetails).toHaveBeenCalledWith(1, "Renamed", "/new.png");
	expect(
		vi.mocked(courses.updateDetails).mock.invocationCallOrder[0],
	).toBeLessThan(vi.mocked(cleanupCover).mock.invocationCallOrder[0]);
});
it("keeps the old cover on failed edit and supports title-only edits and cover removal", async () => {
	vi.mocked(writeCourseCover).mockRejectedValue(
		new Error("new copy rolled back"),
	);
	await expect(
		editCourse(course, "Title", { kind: "png", bytes: new Uint8Array() }),
	).rejects.toThrow("rolled back");
	expect(cleanupCover).not.toHaveBeenCalled();
	await editCourse(course, "Renamed", undefined);
	expect(courses.updateDetails).toHaveBeenCalledWith(
		1,
		"Renamed",
		course.cover_path,
	);
	await editCourse(course, "Renamed", null);
	expect(courses.updateDetails).toHaveBeenCalledWith(1, "Renamed", null);
});
it("relocates only after a fresh match check and restores both DB/root registration when registration fails", async () => {
	vi.mocked(registerCourseRoot).mockResolvedValueOnce({
		courseId: 1,
		status: "unauthorized",
		message: "re-pick",
	});
	await expect(relocate(course, "/new")).rejects.toThrow("re-pick");
	expect(courses.updateRoot).toHaveBeenNthCalledWith(1, 1, "/new");
	expect(courses.updateRoot).toHaveBeenNthCalledWith(2, 1, "/old");
	expect(registerCourseRoot).toHaveBeenLastCalledWith(1, "/old");
	expect(syncCourse).not.toHaveBeenCalled();
});
it("surfaces root rollback failure and keeps a newly registered location when sync later fails", async () => {
	vi.mocked(registerCourseRoot).mockResolvedValueOnce({
		courseId: 1,
		status: "missing",
		message: "gone",
	});
	vi.mocked(courses.updateRoot)
		.mockResolvedValueOnce()
		.mockRejectedValueOnce(new Error("rollback locked"));
	await expect(relocate(course, "/new")).rejects.toThrow(
		"Root rollback also failed",
	);
	vi.mocked(courses.updateRoot).mockResolvedValue();
	vi.mocked(syncCourse).mockResolvedValue({
		ok: false,
		code: "ROOT_UNREADABLE",
		message: "unmounted",
	});
	expect(await relocate(course, "/new")).toContain(
		"Folder updated, but sync failed",
	);
});
it("detects canonical aliases of another course and blocks confirmation without changing the root", async () => {
	vi.mocked(courses.list).mockResolvedValue([
		course,
		{ ...course, id: 2, root_path: "/alias" },
	]);
	vi.mocked(canonicalizeRoot).mockResolvedValue("/new");
	expect((await previewRelocation(1, "/new")).error).toContain(
		"another course",
	);
	await expect(relocate(course, "/new")).rejects.toThrow("already used");
	expect(courses.updateRoot).not.toHaveBeenCalled();
});
it("rescans with best-effort flush and reports folder errors, never replacing them with success", async () => {
	await rescan(course);
	expect(flushPendingData).toHaveBeenCalled();
	expect(syncCourse).toHaveBeenCalledWith(1);
	vi.mocked(syncCourse).mockResolvedValue({
		ok: false,
		code: "FOLDER_NOT_AUTHORIZED",
		message: "re-pick",
	});
	await expect(rescan(course)).rejects.toThrow("FOLDER_NOT_AUTHORIZED");
});
