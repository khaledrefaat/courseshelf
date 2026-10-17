import type { Course } from "@/lib/db/courses";
import { getDb } from "@/lib/db/db";
import { waitForProgressWrites } from "@/lib/db/progressWrites";

export interface OutlineLesson {
	id: number;
	course_id: number;
	title: string;
	relative_path: string;
	sort_order: number;
	completed: boolean;
	missing_at: string | null;
}
export interface CourseOutline {
	course: Course;
	lessons: OutlineLesson[];
}
interface OutlineRow extends Course {
	lesson_id: number | null;
	lesson_title: string;
	relative_path: string;
	sort_order: number;
	completed: 0 | 1;
}

export async function getCourseOutline(
	courseId: number,
): Promise<CourseOutline | null> {
	await waitForProgressWrites();
	const db = await getDb();
	const rows = await db.select<OutlineRow[]>(
		`
		SELECT c.id, c.title, c.root_path, c.cover_path, c.created_at,
			l.id AS lesson_id, l.title AS lesson_title, l.relative_path, l.sort_order,
			COALESCE(p.completed, 0) AS completed
		FROM courses c
		LEFT JOIN lessons l ON l.course_id = c.id AND l.missing_at IS NULL
		LEFT JOIN progress p ON p.lesson_id = l.id
		WHERE c.id = $1 ORDER BY l.sort_order, l.id
	`,
		[courseId],
	);
	if (!rows.length) return null;
	const { id, title, root_path, cover_path, created_at } = rows[0];
	return {
		course: { id, title, root_path, cover_path, created_at },
		lessons: rows.flatMap((row) =>
			row.lesson_id === null
				? []
				: [
						{
							id: row.lesson_id,
							course_id: id,
							title: row.lesson_title,
							relative_path: row.relative_path,
							sort_order: row.sort_order,
							completed: row.completed === 1,
							missing_at: null,
						},
					],
		),
	};
}
