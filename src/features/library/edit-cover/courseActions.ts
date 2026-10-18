import { appDataDir } from "@tauri-apps/api/path";
import { remove } from "@tauri-apps/plugin-fs";
import {
	type PickedCover,
	writeCourseCover,
} from "@/features/library/add-course/covers";
import { errorMessage } from "@/features/library/add-course/folders";
import { resolveCoverPath } from "@/lib/cover-paths";
import {
	delete as deleteCourse,
	getById,
	list,
	updateCover,
} from "@/lib/db/courses";
import { waitForProgressWrites } from "@/lib/db/progressWrites";

// Delete only UUID covers created by this app for this specific course.
// Legacy/external paths and paths containing directory traversal are left alone.
export function managedCoverPath(
	courseId: number,
	storedPath: string | null,
	dataDir: string,
): string | null {
	if (!storedPath || !Number.isSafeInteger(courseId) || courseId < 1)
		return null;
	const resolved = resolveCoverPath(storedPath, dataDir);
	if (!resolved) return null;
	return new RegExp(
		`^${courseId}-[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}[.](png|jpg|webp)$`,
		"i",
	).test(resolved.relative)
		? resolved.path
		: null;
}

const saving = new Set<number>();
export async function cleanupCover(
	courseId: number,
	oldPath: string | null,
	label: string,
): Promise<string | null> {
	if (!oldPath) return null;
	try {
		const directory = await appDataDir();
		const old = managedCoverPath(courseId, oldPath, directory);
		if (old) {
			const shared = (await list()).some(
				(row) =>
					row.id !== courseId &&
					managedCoverPath(courseId, row.cover_path, directory) === old,
			);
			if (!shared) await remove(old);
		}
	} catch (error) {
		if (
			!/no such file|not found|os error 2(?![0-9])/i.test(errorMessage(error))
		)
			return `${label}, but the old cover file could not be cleaned up: ${errorMessage(error)}`;
	}
	return null;
}

export async function deleteCourseFromLibrary(
	courseId: number,
): Promise<string | null> {
	if (saving.has(courseId))
		throw new Error("This course is already being updated.");
	saving.add(courseId);
	try {
		await waitForProgressWrites();
		const course = await getById(courseId);
		if (!course) throw new Error("This course no longer exists.");
		// SQLite cascades lessons, progress and notes; never touch the course root.
		await deleteCourse(courseId);
		return await cleanupCover(courseId, course.cover_path, "Course deleted");
	} finally {
		saving.delete(courseId);
	}
}

export async function updateCourseCover(
	courseId: number,
	expectedPath: string | null,
	cover: PickedCover | null,
): Promise<{ path: string | null; warning: string | null }> {
	if (saving.has(courseId))
		throw new Error("This course cover is already being saved.");
	saving.add(courseId);
	try {
		const course = await getById(courseId);
		if (!course) throw new Error("This course no longer exists.");
		if (course.cover_path !== expectedPath)
			throw new Error(
				"The cover changed while you were editing. Reopen Edit cover and try again.",
			);
		let path: string | null = null;
		// The old file is not touched until the new file AND its DB path are saved.
		if (cover) path = await writeCourseCover(courseId, cover);
		else await updateCover(courseId, null);
		const warning =
			expectedPath !== path
				? await cleanupCover(courseId, expectedPath, "Cover updated")
				: null;
		return { path, warning };
	} finally {
		saving.delete(courseId);
	}
}
