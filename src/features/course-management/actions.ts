import { flushPendingData } from "@/features/course/closeProgress";
import {
	allowSubtitleGeneration,
	cancelGeneration,
	cleanupGeneratedSubtitles,
	prepareSubtitleRemoval,
} from "@/features/course/subtitleGeneration";
import {
	relocationMatch,
	syncMessage,
	validTitle,
} from "@/features/course-management/model";
import {
	manage,
	pauseCourse,
	refreshManagement,
} from "@/features/course-management/state";
import {
	type PickedCover,
	writeCourseCover,
} from "@/features/library/add-course/covers";
import {
	canonicalizeRoot,
	errorMessage,
} from "@/features/library/add-course/folders";
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

export async function previewRelocation(courseId: number, path: string) {
	const scan = await scanCourse(await canonicalizeRoot(path));
	let duplicate = false;
	for (const course of await courses.list()) {
		if (course.id === courseId) continue;
		if (course.root_path === scan.root_path) {
			duplicate = true;
			break;
		}
		try {
			if ((await canonicalizeRoot(course.root_path)) === scan.root_path)
				duplicate = true;
		} catch (cause) {
			if (!/no such file|not found|os error 2\b/i.test(errorMessage(cause)))
				throw new Error(
					`Could not check “${course.title}” for duplicate folders: ${errorMessage(cause)}`,
				);
		}
	}
	const match = relocationMatch(
		await listAllByCourse(courseId),
		scan.lessons,
		duplicate,
	);
	return { scan, ...match };
}

export function rescan(course: courses.Course) {
	return manage(async () => {
		await cancelGeneration(course.id);
		pauseCourse(course.id);
		await flushPendingData();
		const result = await syncCourse(course.id);
		await registerCourseRoot(course.id, course.root_path);
		refreshManagement(
			result.ok ? syncMessage(result) : result.message,
			result.ok ? undefined : course.id,
			course.id,
		);
		if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
		return result;
	});
}

export function relocate(course: courses.Course, path: string) {
	return manage(async () => {
		await cancelGeneration(course.id);
		const current = await courses.getById(course.id);
		if (!current || current.root_path !== course.root_path)
			throw new Error("The course folder changed. Reopen Locate folder.");
		pauseCourse(course.id);
		await flushPendingData();
		const preview = await previewRelocation(course.id, path);
		if (preview.error) throw new Error(preview.error);
		await courses.updateRoot(course.id, preview.scan.root_path);
		let registration: Awaited<ReturnType<typeof registerCourseRoot>>;
		try {
			registration = await registerCourseRoot(
				course.id,
				preview.scan.root_path,
			);
			if (registration.status !== "registered")
				throw new Error(registration.message);
		} catch (cause) {
			let message = `Could not register the new folder: ${errorMessage(cause)}`;
			try {
				await courses.updateRoot(course.id, course.root_path);
			} catch (rollback) {
				message += ` Root rollback also failed: ${errorMessage(rollback)}`;
			}
			try {
				const old = await registerCourseRoot(course.id, course.root_path);
				if (old.status !== "registered")
					message += ` Previous folder is ${old.status}: ${old.message}`;
			} catch (rollback) {
				message += ` Registration rollback failed: ${errorMessage(rollback)}`;
			}
			refreshManagement(message, undefined, course.id);
			throw new Error(message);
		}
		const result = await syncCourse(course.id);
		const message = result.ok
			? `Folder updated. ${syncMessage(result)}`
			: `Folder updated, but sync failed: ${result.message}. Use Rescan folder to retry.`;
		refreshManagement(message, undefined, course.id);
		return message;
	});
}

export function editCourse(
	course: courses.Course,
	title: string,
	cover: PickedCover | null | undefined,
) {
	return manage(async () => {
		if (!validTitle(title))
			throw new Error("Enter a title between 1 and 120 characters.");
		const current = await courses.getById(course.id);
		if (
			!current ||
			current.cover_path !== course.cover_path ||
			current.title !== course.title
		)
			throw new Error("The course changed. Reopen Edit course.");
		let path = cover === undefined ? course.cover_path : null;
		if (cover)
			path = await writeCourseCover(course.id, cover, (next) =>
				courses.updateDetails(course.id, title.trim(), next),
			);
		else await courses.updateDetails(course.id, title.trim(), path);
		const warning =
			path !== course.cover_path
				? await cleanupCover(course.id, course.cover_path, "Course updated")
				: null;
		refreshManagement(warning ?? "Course updated.");
		return { path, warning };
	});
}

export function archiveCourse(courseId: number, archived: boolean) {
	return manage(async () => {
		await courses.setArchived(courseId, archived);
		refreshManagement(archived ? "Course archived." : "Course restored.");
	});
}

export function removeCourse(courseId: number) {
	return manage(async () => {
		const course = await courses.getById(courseId);
		if (!course) throw new Error("Course no longer exists.");
		const ids = (await listAllByCourse(courseId)).map((lesson) => lesson.id);
		const subtitlePreparation = prepareSubtitleRemoval(courseId);
		// Block new writes synchronously before pausing (pause itself normally saves).
		const draining = discardLessonWrites(ids);
		const drafts = notesController.discardCourse(courseId);
		pauseCourse(courseId);
		let generated: Awaited<ReturnType<typeof prepareSubtitleRemoval>>;
		try {
			[generated] = await Promise.all([subtitlePreparation, draining, drafts]);
			await courses.delete(courseId);
		} catch (cause) {
			allowLessonWrites(ids);
			allowSubtitleGeneration(courseId);
			throw cause;
		}
		const warnings: string[] = [];
		const subtitleWarning = await cleanupGeneratedSubtitles(generated);
		if (subtitleWarning) warnings.push(subtitleWarning);
		allowSubtitleGeneration(courseId);
		const cleanup = await cleanupCover(
			courseId,
			course.cover_path,
			"Course removed",
		);
		if (cleanup) warnings.push(cleanup);
		try {
			await unregisterCourseRoot(courseId);
		} catch {
			warnings.push(
				"Playback unregistration failed; restart Courseshelf to revoke the old root.",
			);
		}
		refreshManagement(
			warnings.join(" ") || "Course removed. Video files were not touched.",
		);
		return warnings.join(" ");
	});
}
