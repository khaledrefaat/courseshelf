import * as courses from "@/lib/db/courses";
import * as lessons from "@/lib/db/lessons";
import { type CourseSummary, getCourseSummary } from "@/lib/db/progress";
import { scanCourse } from "@/lib/scanner/scanCourse";

export type SyncErrorCode =
	| "COURSE_NOT_FOUND"
	| "FOLDER_NOT_AUTHORIZED"
	| "ROOT_UNREADABLE"
	| "SCAN_FAILED"
	| "ZERO_VIDEOS"
	| "DB_ERROR";

export type SyncResult =
	| {
			ok: true;
			course_id: number;
			scan: Awaited<ReturnType<typeof scanCourse>>;
			added_count: number;
			missing_count: number;
			summary: CourseSummary;
	  }
	| { ok: false; code: SyncErrorCode; message: string };

const inFlight = new Map<number, Promise<SyncResult>>();

export function syncCourse(courseId: number): Promise<SyncResult> {
	const running = inFlight.get(courseId);
	if (running) return running;
	const task = runSync(courseId).finally(() => inFlight.delete(courseId));
	inFlight.set(courseId, task);
	return task;
}

async function runSync(courseId: number): Promise<SyncResult> {
	let stage: SyncErrorCode = "DB_ERROR";
	try {
		const course = await courses.getById(courseId);
		if (!course)
			return {
				ok: false,
				code: "COURSE_NOT_FOUND",
				message: "Course not found",
			};
		stage = "SCAN_FAILED";
		// Do not write anything until the entire traversal has succeeded.
		const scan = await scanCourse(course.root_path);
		stage = "DB_ERROR";
		const previous = await lessons.listAllByCourse(courseId);
		if (scan.lessons.length === 0 && previous.length > 0) {
			return {
				ok: false,
				code: "ZERO_VIDEOS",
				message:
					"No videos found; existing lessons were left unchanged. Check that the course drive is mounted.",
			};
		}
		const found = new Set(scan.lessons.map((lesson) => lesson.relative_path));
		const known = new Set(previous.map((lesson) => lesson.relative_path));
		const missing = previous.filter(
			(lesson) => !found.has(lesson.relative_path),
		);
		await lessons.upsertMany(courseId, scan.lessons);
		await lessons.markMissing(
			courseId,
			missing.map((lesson) => lesson.id),
		);
		return {
			ok: true,
			course_id: courseId,
			scan,
			added_count: scan.lessons.filter(
				(lesson) => !known.has(lesson.relative_path),
			).length,
			missing_count: missing.length,
			summary: await getCourseSummary(courseId),
		};
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			"message" in error &&
			(error.code === "FOLDER_NOT_AUTHORIZED" ||
				error.code === "ROOT_UNREADABLE" ||
				error.code === "SCAN_FAILED")
		) {
			return { ok: false, code: error.code, message: String(error.message) };
		}
		return { ok: false, code: stage, message: String(error) };
	}
}
