import type { Lesson } from "@/lib/db/lessons";
export function relocationMatch(
	existing: readonly Pick<Lesson, "relative_path">[],
	found: readonly { relative_path: string }[],
	duplicate: boolean,
) {
	const known = new Set(existing.map((lesson) => lesson.relative_path));
	const paths = new Set(found.map((lesson) => lesson.relative_path));
	const matched = [...known].filter((path) => paths.has(path)).length;
	return {
		matched,
		total: known.size,
		added: [...paths].filter((path) => !known.has(path)).length,
		error: duplicate
			? "This folder is already used by another course."
			: matched === 0
				? "No lessons match this course. Choose its course folder, not a parent or section folder."
				: null,
	};
}
export function syncMessage(result: {
	added_count: number;
	missing_count: number;
	restored_count: number;
}) {
	return result.added_count + result.missing_count + result.restored_count === 0
		? "No changes"
		: `${result.added_count} lessons added, ${result.missing_count} marked missing, ${result.restored_count} restored`;
}
export function validTitle(title: string) {
	return title.trim().length > 0 && title.trim().length <= 120;
}
export function backupName(date = new Date()) {
	return `courseshelf-backup-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}.db`;
}
export function refreshedLessonMissing(
	currentId: number | null,
	activeIds: readonly number[],
) {
	return currentId !== null && !activeIds.includes(currentId);
}
