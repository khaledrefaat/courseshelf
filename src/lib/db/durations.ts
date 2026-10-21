import { getDb } from "@/lib/db/db";

// A partial sum must not be presented as the full course length. Ignore missing
// lessons in callers and reject invalid cached values, including SQLite infinity.
export const durationTotalSql = `CASE
	WHEN COUNT(*) > 0 AND SUM(CASE WHEN duration_seconds > 0
		AND duration_seconds <= ${Number.MAX_VALUE} THEN 1 ELSE 0 END) = COUNT(*)
	THEN SUM(duration_seconds) ELSE NULL END`;

export interface DurationLesson {
	id: number;
	course_id: number;
	relative_path: string;
	duration_seconds: number | null;
}

export async function listUncachedDurations(
	courseId: number,
): Promise<DurationLesson[]> {
	const db = await getDb();
	return db.select<DurationLesson[]>(
		`SELECT id, course_id, relative_path, duration_seconds FROM lessons
		WHERE course_id=$1 AND missing_at IS NULL AND (duration_seconds IS NULL
			OR duration_seconds <= 0 OR duration_seconds > ${Number.MAX_VALUE})
		ORDER BY sort_order, id`,
		[courseId],
	);
}

export async function getCourseDuration(
	courseId: number,
): Promise<number | null> {
	const db = await getDb();
	const rows = await db.select<{ seconds: number | null }[]>(
		`SELECT ${durationTotalSql} AS seconds FROM lessons WHERE course_id=$1 AND missing_at IS NULL`,
		[courseId],
	);
	const seconds = rows[0]?.seconds;
	return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
		? seconds
		: null;
}

const revisions = new Map<number, number>();
const writes = new Map<number, Promise<unknown>>();
function ordered<T>(courseId: number, operation: () => Promise<T>): Promise<T> {
	const task = (writes.get(courseId) ?? Promise.resolve())
		.catch(() => undefined)
		.then(operation);
	writes.set(courseId, task);
	void task
		.finally(() => {
			if (writes.get(courseId) === task) writes.delete(courseId);
		})
		.catch(() => undefined);
	return task;
}
export const durationRevision = (courseId: number) =>
	revisions.get(courseId) ?? 0;

export async function invalidateDurations(courseId: number): Promise<void> {
	revisions.set(courseId, durationRevision(courseId) + 1);
	await ordered(courseId, async () => {
		const db = await getDb();
		await db.execute(
			"UPDATE lessons SET duration_seconds=NULL WHERE course_id=$1",
			[courseId],
		);
	});
}

export async function saveDuration(
	courseId: number,
	lessonId: number,
	seconds: number,
	revision: number,
): Promise<boolean> {
	if (!Number.isFinite(seconds) || seconds <= 0) return false;
	return ordered(courseId, async () => {
		const db = await getDb();
		if (durationRevision(courseId) !== revision) return false;
		const result = await db.execute(
			"UPDATE lessons SET duration_seconds=$1 WHERE id=$2 AND course_id=$3 AND missing_at IS NULL",
			[seconds, lessonId, courseId],
		);
		return result.rowsAffected > 0 && durationRevision(courseId) === revision;
	});
}
