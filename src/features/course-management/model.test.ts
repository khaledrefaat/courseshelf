import { expect, it } from "vitest";
import {
	backupName,
	refreshedLessonMissing,
	relocationMatch,
	syncMessage,
	validTitle,
} from "@/features/course-management/model";

it("matches by exact relative paths and blocks zero matches or a duplicate, including older missing paths", () => {
	const old = [{ relative_path: "قسم/1.mp4" }, { relative_path: "two.webm" }];
	expect(
		relocationMatch(
			old,
			[{ relative_path: "قسم/1.mp4" }, { relative_path: "new.mp4" }],
			false,
		),
	).toEqual({ matched: 1, total: 2, added: 1, error: null });
	expect(
		relocationMatch(old, [{ relative_path: "other.mp4" }], false).error,
	).toContain("No lessons match");
	expect(relocationMatch(old, [old[0]], true).error).toContain(
		"another course",
	);
	expect(relocationMatch([], [], false).error).not.toBeNull();
});
it("formats changed/restored sync counts and No changes", () => {
	expect(
		syncMessage({ added_count: 0, missing_count: 0, restored_count: 0 }),
	).toBe("No changes");
	expect(
		syncMessage({ added_count: 2, missing_count: 3, restored_count: 4 }),
	).toBe("2 lessons added, 3 marked missing, 4 restored");
});
it("only redirects a previously viewed lesson if it is no longer available", () => {
	expect(refreshedLessonMissing(1, [2, 3])).toBe(true);
	expect(refreshedLessonMissing(1, [1, 2])).toBe(false);
	expect(refreshedLessonMissing(null, [])).toBe(false);
});
it("validates trimmed titles and names backups with a local calendar date", () => {
	expect(validTitle("  Course  ")).toBe(true);
	expect(validTitle(" ")).toBe(false);
	expect(validTitle("a".repeat(121))).toBe(false);
	expect(backupName(new Date(2026, 9, 17, 23, 0))).toBe(
		"courseshelf-backup-2026-10-17.db",
	);
});
