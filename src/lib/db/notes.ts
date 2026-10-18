import { getDb } from "@/lib/db/db";
import {
	queueProgressWrite,
	waitForProgressWrites,
} from "@/lib/db/progressWrites";
import { displayTitle } from "@/lib/displayTitle";

export interface Note {
	lesson_id: number;
	content: string;
	updated_at: string;
}

export async function get(lessonId: number): Promise<Note | null> {
	const db = await getDb();
	const rows = await db.select<Note[]>(
		"SELECT * FROM notes WHERE lesson_id = $1",
		[lessonId],
	);
	return rows[0] ?? null;
}

export function isEmptyNote(content: string): boolean {
	return content.trim().length === 0;
}

async function deleteRow(lessonId: number): Promise<void> {
	const db = await getDb();
	await db.execute("DELETE FROM notes WHERE lesson_id = $1", [lessonId]);
}
function deleteNote(lessonId: number): Promise<void> {
	return queueProgressWrite(lessonId, () => deleteRow(lessonId));
}

export { deleteNote as delete };

export function save(lessonId: number, content: string): Promise<void> {
	if (content.length > 50_000)
		return Promise.reject(new Error("Notes cannot exceed 50,000 characters."));
	return queueProgressWrite(lessonId, async () => {
		if (isEmptyNote(content)) return deleteRow(lessonId);
		const db = await getDb();
		await db.execute(
			`INSERT INTO notes (lesson_id, content) VALUES ($1, $2)
		 ON CONFLICT (lesson_id) DO UPDATE SET
		     content = excluded.content, updated_at = CURRENT_TIMESTAMP`,
			[lessonId, content],
		);
	});
}

export interface CourseNote extends Note {
	title: string;
	relative_path: string;
	sort_order: number;
}

export async function listByCourse(courseId: number): Promise<CourseNote[]> {
	await waitForProgressWrites();
	const db = await getDb();
	const rows = await db.select<CourseNote[]>(
		`SELECT n.lesson_id, n.content, n.updated_at,
		l.title, l.relative_path, l.sort_order
		FROM notes n JOIN lessons l ON l.id = n.lesson_id
		WHERE l.course_id = $1 AND l.missing_at IS NULL
		ORDER BY l.sort_order, l.id`,
		[courseId],
	);
	return rows
		.filter((row) => !isEmptyNote(row.content))
		.map((row) => ({ ...row, title: displayTitle(row.title) }));
}
