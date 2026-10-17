import { getDb } from "@/lib/db/db";

export interface CourseSummary {
	id: number;
	title: string;
	cover_path: string | null;
	created_at: string;
	total_lessons: number;
	completed_lessons: number;
	last_watched_at: string | null;
	resume_lesson_id: number | null;
	resume_lesson_title: string | null;
}

export async function listCourseSummaries(): Promise<CourseSummary[]> {
	const db = await getDb();
	return db.select<CourseSummary[]>(`
		WITH active AS (
			SELECT l.*, COALESCE(p.completed, 0) AS completed, p.last_watched_at
			FROM lessons l LEFT JOIN progress p ON p.lesson_id = l.id
			WHERE l.missing_at IS NULL
		), totals AS (
			SELECT course_id, COUNT(*) AS total_lessons,
				SUM(completed) AS completed_lessons, MAX(last_watched_at) AS last_watched_at
			FROM active GROUP BY course_id
		), watched AS (
			SELECT *, ROW_NUMBER() OVER (
				PARTITION BY course_id ORDER BY last_watched_at DESC, sort_order, id
			) AS rank FROM active WHERE last_watched_at IS NOT NULL
		), candidates AS (
			SELECT a.*, ROW_NUMBER() OVER (PARTITION BY a.course_id ORDER BY
				CASE
					WHEN w.completed = 0 AND a.id = w.id THEN 0
					WHEN w.completed = 1 AND (a.sort_order > w.sort_order OR
						(a.sort_order = w.sort_order AND a.id > w.id)) THEN 1
					WHEN a.completed = 0 THEN 2 ELSE 3
				END, a.sort_order, a.id
			) AS rank
			FROM active a LEFT JOIN watched w ON w.course_id = a.course_id AND w.rank = 1
			JOIN totals t ON t.course_id = a.course_id
			WHERE t.completed_lessons < t.total_lessons
				AND (a.completed = 0 OR (w.completed = 1 AND
					(a.sort_order > w.sort_order OR (a.sort_order = w.sort_order AND a.id > w.id))))
		)
		SELECT c.id, c.title, c.cover_path, c.created_at,
			COALESCE(t.total_lessons, 0) AS total_lessons,
			COALESCE(t.completed_lessons, 0) AS completed_lessons,
			t.last_watched_at, r.id AS resume_lesson_id, r.title AS resume_lesson_title
		FROM courses c LEFT JOIN totals t ON t.course_id = c.id
		LEFT JOIN candidates r ON r.course_id = c.id AND r.rank = 1
		ORDER BY c.id
	`);
}
