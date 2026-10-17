import { getDb } from "@/lib/db/db";

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

export async function save(lessonId: number, content: string): Promise<void> {
	const db = await getDb();
	await db.execute(
		`INSERT INTO notes (lesson_id, content) VALUES ($1, $2)
		 ON CONFLICT (lesson_id) DO UPDATE SET
		     content = excluded.content, updated_at = CURRENT_TIMESTAMP`,
		[lessonId, content],
	);
}
