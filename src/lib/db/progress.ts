import { getDb } from "@/lib/db/db";

export interface Progress {
	lesson_id: number;
	completed: boolean;
	last_position_seconds: number;
	last_watched_at: string | null;
}

type ProgressRow = Omit<Progress, "completed"> & { completed: 0 | 1 };

export interface CourseSummary {
	completed_count: number;
	total_count: number;
}

export async function get(lessonId: number): Promise<Progress | null> {
	const db = await getDb();
	const [row] = await db.select<ProgressRow[]>(
		"SELECT * FROM progress WHERE lesson_id = $1",
		[lessonId],
	);
	return row ? { ...row, completed: row.completed === 1 } : null;
}

export async function setCompleted(
	lessonId: number,
	completed: boolean,
): Promise<void> {
	const db = await getDb();
	await db.execute(
		`INSERT INTO progress (lesson_id, completed) VALUES ($1, $2)
		 ON CONFLICT (lesson_id) DO UPDATE SET completed = excluded.completed`,
		[lessonId, completed ? 1 : 0],
	);
}

export async function savePosition(
	lessonId: number,
	seconds: number,
): Promise<void> {
	if (!Number.isFinite(seconds) || seconds < 0) {
		throw new Error("Playback position must be a finite, nonnegative number");
	}
	const db = await getDb();
	await db.execute(
		`INSERT INTO progress (lesson_id, last_position_seconds, last_watched_at)
		 VALUES ($1, $2, CURRENT_TIMESTAMP)
		 ON CONFLICT (lesson_id) DO UPDATE SET
		     last_position_seconds = excluded.last_position_seconds,
		     last_watched_at = CURRENT_TIMESTAMP`,
		[lessonId, seconds],
	);
}

export async function getCourseSummary(
	courseId: number,
): Promise<CourseSummary> {
	const db = await getDb();
	const [row] = await db.select<CourseSummary[]>(
		`SELECT COUNT(*) AS total_count,
		        COALESCE(SUM(COALESCE(progress.completed, 0)), 0) AS completed_count
		 FROM lessons LEFT JOIN progress ON progress.lesson_id = lessons.id
		 WHERE lessons.course_id = $1`,
		[courseId],
	);
	if (!row) throw new Error("Course summary query returned no row");
	return row;
}
