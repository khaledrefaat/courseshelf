import { getDb } from "@/lib/db/db";

export interface GeneratedSubtitle {
	lessonId: number;
	filename: string;
	sourceFingerprint: string;
	modelId: string;
	modelSha256: string;
}
const columns = `g.lesson_id AS lessonId, g.filename, g.source_fingerprint AS sourceFingerprint,
	g.model_id AS modelId, g.model_sha256 AS modelSha256`;

export async function getGeneratedSubtitle(
	lessonId: number,
): Promise<GeneratedSubtitle | null> {
	const db = await getDb();
	const rows = await db.select<GeneratedSubtitle[]>(
		`SELECT ${columns} FROM generated_subtitles g WHERE g.lesson_id=$1`,
		[lessonId],
	);
	return rows[0] ?? null;
}

export async function saveGeneratedSubtitle(
	courseId: number,
	relativePath: string,
	row: GeneratedSubtitle,
): Promise<void> {
	const db = await getDb();
	const result = await db.execute(
		`INSERT INTO generated_subtitles (lesson_id,filename,source_fingerprint,model_id,model_sha256)
		SELECT id,$1,$2,$3,$4 FROM lessons WHERE id=$5 AND course_id=$6 AND relative_path=$7 AND missing_at IS NULL
		ON CONFLICT(lesson_id) DO UPDATE SET filename=excluded.filename, source_fingerprint=excluded.source_fingerprint,
		model_id=excluded.model_id, model_sha256=excluded.model_sha256, updated_at=CURRENT_TIMESTAMP`,
		[
			row.filename,
			row.sourceFingerprint,
			row.modelId,
			row.modelSha256,
			row.lessonId,
			courseId,
			relativePath,
		],
	);
	if (!result.rowsAffected)
		throw new Error(
			"Lesson changed or was removed before subtitles could be saved.",
		);
}

export async function removeGeneratedSubtitle(
	lessonId: number,
	filename: string,
): Promise<void> {
	const db = await getDb();
	await db.execute(
		"DELETE FROM generated_subtitles WHERE lesson_id=$1 AND filename=$2",
		[lessonId, filename],
	);
}

export async function listGeneratedSubtitles(
	courseId: number,
): Promise<GeneratedSubtitle[]> {
	const db = await getDb();
	return db.select<GeneratedSubtitle[]>(
		`SELECT ${columns} FROM generated_subtitles g JOIN lessons l ON l.id=g.lesson_id WHERE l.course_id=$1 ORDER BY l.sort_order,l.id`,
		[courseId],
	);
}
