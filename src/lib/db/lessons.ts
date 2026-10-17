import { getDb } from "@/lib/db/db";

export interface Lesson {
	id: number;
	course_id: number;
	relative_path: string;
	title: string;
	sort_order: number;
	created_at: string;
}

export type LessonInput = Pick<
	Lesson,
	"relative_path" | "title" | "sort_order"
>;

export async function upsertMany(
	courseId: number,
	lessons: readonly LessonInput[],
): Promise<void> {
	if (lessons.length === 0) return;
	const db = await getDb();
	// Keep each statement below even SQLite's older 999-bind limit.
	for (let offset = 0; offset < lessons.length; offset += 200) {
		const batch = lessons.slice(offset, offset + 200);
		const placeholders = batch.map((_, index) => {
			const base = index * 4;
			return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
		});
		await db.execute(
			`INSERT INTO lessons (course_id, relative_path, title, sort_order)
			 VALUES ${placeholders.join(", ")}
			 ON CONFLICT (course_id, relative_path) DO UPDATE SET
			     title = excluded.title, sort_order = excluded.sort_order`,
			batch.flatMap((lesson) => [
				courseId,
				lesson.relative_path,
				lesson.title,
				lesson.sort_order,
			]),
		);
	}
}

export async function listByCourse(courseId: number): Promise<Lesson[]> {
	const db = await getDb();
	const rows = await db.select<Lesson[]>(
		"SELECT * FROM lessons WHERE course_id = $1",
		[courseId],
	);
	return rows.sort(
		(a, b) =>
			a.sort_order - b.sort_order ||
			a.relative_path.localeCompare(b.relative_path, undefined, {
				numeric: true,
			}),
	);
}
