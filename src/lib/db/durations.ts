import { getDb } from "@/lib/db/db";

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
