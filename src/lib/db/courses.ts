import { getDb } from "@/lib/db/db";
import { waitForProgressWrites } from "@/lib/db/progressWrites";

export interface Course {
	id: number;
	title: string;
	root_path: string;
	cover_path: string | null;
	created_at: string;
}

export interface NewCourse {
	title: string;
	root_path: string;
	cover_path?: string | null;
}

export async function create(input: NewCourse): Promise<Course> {
	const id = await insert(input);
	const course = await getById(id);
	if (!course) throw new Error("Created course could not be read back");
	return course;
}

// Import workflows need the ID before any follow-up read can fail, for rollback.
export async function insert(input: NewCourse): Promise<number> {
	const db = await getDb();
	const result = await db.execute(
		"INSERT INTO courses (title, root_path, cover_path) VALUES ($1, $2, $3)",
		[input.title, input.root_path, input.cover_path ?? null],
	);
	if (result.lastInsertId === undefined) {
		throw new Error("SQLite did not return the new course ID");
	}
	return result.lastInsertId;
}

export async function list(): Promise<Course[]> {
	const db = await getDb();
	return db.select<Course[]>(
		"SELECT * FROM courses ORDER BY created_at DESC, id DESC",
	);
}

export async function getById(id: number): Promise<Course | null> {
	const db = await getDb();
	const rows = await db.select<Course[]>(
		"SELECT * FROM courses WHERE id = $1",
		[id],
	);
	return rows[0] ?? null;
}

async function deleteCourse(id: number): Promise<void> {
	const db = await getDb();
	await db.execute("DELETE FROM courses WHERE id = $1", [id]);
}

export async function getByRootPath(rootPath: string): Promise<Course | null> {
	const db = await getDb();
	const [row] = await db.select<Course[]>(
		"SELECT * FROM courses WHERE root_path = $1",
		[rootPath],
	);
	return row ?? null;
}

export { deleteCourse as delete };

// The caller supplies a cover already copied to the app data directory.
export async function updateCover(
	id: number,
	coverPath: string | null,
): Promise<void> {
	const db = await getDb();
	const result = await db.execute(
		"UPDATE courses SET cover_path = $1 WHERE id = $2",
		[coverPath, id],
	);
	if (result.rowsAffected === 0)
		throw new Error("Course not found; the cover was not saved.");
}

export async function updateDetails(
	id: number,
	title: string,
	coverPath: string | null,
): Promise<void> {
	const db = await getDb();
	const result = await db.execute(
		"UPDATE courses SET title=$1, cover_path=$2 WHERE id=$3",
		[title, coverPath, id],
	);
	if (!result.rowsAffected) throw new Error("Course no longer exists.");
}
export async function updateRoot(id: number, root: string): Promise<void> {
	const db = await getDb();
	const result = await db.execute(
		"UPDATE courses SET root_path=$1 WHERE id=$2",
		[root, id],
	);
	if (!result.rowsAffected) throw new Error("Course no longer exists.");
}
export async function removalCounts(
	id: number,
): Promise<{ lessons: number; notes: number }> {
	await waitForProgressWrites();
	const db = await getDb();
	const [row] = await db.select<{ lessons: number; notes: number }[]>(
		`SELECT COUNT(*) AS lessons, COUNT(n.lesson_id) AS notes FROM lessons l LEFT JOIN notes n ON n.lesson_id=l.id WHERE l.course_id=$1`,
		[id],
	);
	return row;
}
