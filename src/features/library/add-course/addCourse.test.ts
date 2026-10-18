import { beforeEach, expect, it, vi } from "vitest";
import { addCourse } from "@/features/library/add-course/addCourse";
import { saveCover } from "@/features/library/add-course/covers";
import { findDuplicate } from "@/features/library/add-course/folders";
import * as courses from "@/lib/db/courses";
import { syncCourse } from "@/lib/db/syncCourse";
import { registerCourseRoot } from "@/lib/playback";
import { scanCourse } from "@/lib/scanner/scanCourse";
import { buildCourseStructure } from "@/lib/scanner/structure";

vi.mock("@/lib/db/courses", () => ({ insert: vi.fn(), delete: vi.fn() }));
vi.mock("@/features/library/add-course/covers", () => ({ saveCover: vi.fn() }));
vi.mock("@/features/library/add-course/folders", async (original) => ({
	...(await original<typeof import("@/features/library/add-course/folders")>()),
	findDuplicate: vi.fn(),
}));
vi.mock("@/lib/db/syncCourse", () => ({ syncCourse: vi.fn() }));
vi.mock("@/lib/playback", () => ({ registerCourseRoot: vi.fn() }));
vi.mock("@/lib/scanner/scanCourse", () => ({ scanCourse: vi.fn() }));
const scan = {
	root_path: "/canonical",
	skipped_symlink_count: 0,
	...buildCourseStructure(["one.mp4"]),
};
const input = {
	root: "/picked",
	title: " SQL ",
	cover: { kind: "png" as const, bytes: new Uint8Array([1]) },
};
beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(scanCourse).mockResolvedValue(scan);
	vi.mocked(findDuplicate).mockResolvedValue(false);
	vi.mocked(courses.insert).mockResolvedValue(7);
	vi.mocked(saveCover).mockResolvedValue(null);
	vi.mocked(syncCourse).mockResolvedValue({
		ok: true,
		course_id: 7,
		scan,
		added_count: 1,
		missing_count: 0,
		restored_count: 0,
		summary: { total_count: 1, completed_count: 0 },
	});
	vi.mocked(registerCourseRoot).mockResolvedValue({
		courseId: 7,
		status: "registered",
		message: "Registered",
	});
});
it("rescans, creates/syncs, registers, then copies cover in that order", async () => {
	expect(await addCourse(input)).toEqual({ courseId: 7, warning: null });
	expect(courses.insert).toHaveBeenCalledWith({
		title: "SQL",
		root_path: "/canonical",
	});
	const order = [
		scanCourse,
		findDuplicate,
		courses.insert,
		syncCourse,
		registerCourseRoot,
		saveCover,
	].map((fn) => vi.mocked(fn).mock.invocationCallOrder[0]);
	expect(order).toEqual([...order].sort((a, b) => a - b));
	expect(courses.delete).not.toHaveBeenCalled();
});
it.each(["empty", "duplicate", "unreadable"])(
	"does not create anything after %s preview changes",
	async (problem) => {
		if (problem === "empty")
			vi.mocked(scanCourse).mockResolvedValue({
				...scan,
				...buildCourseStructure([]),
			});
		if (problem === "duplicate")
			vi.mocked(findDuplicate).mockResolvedValue(true);
		if (problem === "unreadable")
			vi.mocked(scanCourse).mockRejectedValue({
				code: "ROOT_UNREADABLE",
				message: "Drive missing",
			});
		await expect(addCourse(input)).rejects.toThrow();
		expect(courses.insert).not.toHaveBeenCalled();
		expect(saveCover).not.toHaveBeenCalled();
	},
);
it("rolls back a partial lesson sync before touching covers", async () => {
	vi.mocked(syncCourse).mockResolvedValue({
		ok: false,
		code: "DB_ERROR",
		message: "Failed lessons",
	});
	await expect(addCourse(input)).rejects.toThrow("Failed lessons");
	expect(courses.delete).toHaveBeenCalledWith(7);
	expect(saveCover).not.toHaveBeenCalled();
});
it("rolls back registration failure and includes a rollback failure in the visible error", async () => {
	vi.mocked(registerCourseRoot).mockResolvedValue({
		courseId: 7,
		status: "unauthorized",
		message: "Folder not authorized",
	});
	vi.mocked(courses.delete).mockRejectedValue(new Error("DB locked"));
	await expect(addCourse(input)).rejects.toThrow(
		/Folder not authorized.*Rollback failed.*#7.*DB locked/,
	);
	expect(saveCover).not.toHaveBeenCalled();
});
it("retains a successful course on a cover-only failure", async () => {
	vi.mocked(saveCover).mockResolvedValue("Cover wasn't saved");
	expect(await addCourse(input)).toEqual({
		courseId: 7,
		warning: "Cover wasn't saved",
	});
	expect(courses.delete).not.toHaveBeenCalled();
});
it("does not allow double submission", async () => {
	let resolve!: (value: typeof scan) => void;
	vi.mocked(scanCourse).mockReturnValue(
		new Promise((done) => {
			resolve = done;
		}),
	);
	const first = addCourse(input);
	await expect(addCourse(input)).rejects.toThrow("already being added");
	resolve(scan);
	await first;
	expect(courses.insert).toHaveBeenCalledTimes(1);
});
