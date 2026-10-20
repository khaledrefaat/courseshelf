import { getDb } from "@/lib/db/db";
import { queueProgressWrite } from "@/lib/db/progressWrites";
import {
	MODEL,
	PROMPT_VERSION,
	VALIDATOR_VERSION,
} from "@/lib/flashcards/core";
import {
	type GeneratedCard,
	type GenerationResult,
	type Source,
	validateEdit,
} from "@/lib/flashcards/pipeline";

export interface FlashcardLesson {
	courseId: number;
	lessonId: number;
	relativePath: string;
	rootPath: string;
	lessonCreated: string;
	courseCreated: string;
}
export interface SavedCard extends GeneratedCard {
	id: number;
	edited: boolean;
}
export interface FlashcardSet {
	id: number;
	lessonId: number;
	generationId: string;
	sourceHash: string;
	sourceFingerprint: string;
	sourceName: string;
	model: string;
	promptVersion: string;
	validatorVersion: string;
	notes: string;
	updatedAt: string;
	cards: SavedCard[];
	usage: GenerationResult["usage"];
}

export async function flashcardLesson(
	courseId: number,
	lessonId: number,
): Promise<FlashcardLesson> {
	const db = await getDb();
	const rows = await db.select<FlashcardLesson[]>(
		`SELECT l.id AS lessonId,l.course_id AS courseId,l.relative_path AS relativePath,
		c.root_path AS rootPath,l.created_at AS lessonCreated,c.created_at AS courseCreated
		FROM lessons l JOIN courses c ON c.id=l.course_id WHERE l.id=$1 AND c.id=$2 AND l.missing_at IS NULL`,
		[lessonId, courseId],
	);
	if (!rows[0])
		throw new Error("Lesson changed or is missing. Reopen the course.");
	return rows[0];
}

export async function readFlashcards(
	lessonId: number,
): Promise<FlashcardSet | null> {
	const db = await getDb();
	const rows = await db.select<
		(Omit<FlashcardSet, "cards" | "usage"> & {
			cardsJson: string;
			usageJson: string;
		})[]
	>(
		`SELECT s.id,s.lesson_id AS lessonId,s.generation_id AS generationId,s.source_hash AS sourceHash,
		s.source_fingerprint AS sourceFingerprint,s.source_name AS sourceName,s.model,s.prompt_version AS promptVersion,
		s.validator_version AS validatorVersion,s.notes,s.updated_at AS updatedAt,s.usage_json AS usageJson,
		(SELECT json_group_array(json_object('id',id,'question',question,'answer',answer,'extraContext',extra_context,
		'evidence',json(evidence_json),'edited',edited)) FROM (SELECT * FROM flashcards WHERE set_id=s.id ORDER BY sort_order)) AS cardsJson
		FROM flashcard_sets s WHERE s.lesson_id=$1`,
		[lessonId],
	);
	if (!rows[0]) return null;
	const { cardsJson, usageJson, ...metadata } = rows[0];
	const cards: SavedCard[] = JSON.parse(cardsJson);
	return {
		...metadata,
		cards: cards.map((card) => ({ ...card, edited: !!card.edited })),
		usage: JSON.parse(usageJson),
	};
}

// Includes empty sets without loading every card into a course preview.
export async function flashcardStamp(lessonId: number): Promise<{
	sourceHash: string;
	sourceFingerprint: string;
} | null> {
	const db = await getDb();
	const rows = await db.select<
		{ sourceHash: string; sourceFingerprint: string }[]
	>(
		"SELECT source_hash AS sourceHash,source_fingerprint AS sourceFingerprint FROM flashcard_sets WHERE lesson_id=$1",
		[lessonId],
	);
	return rows[0] ?? null;
}

export async function saveFlashcards(
	identity: FlashcardLesson,
	jobId: string,
	source: Source,
	result: GenerationResult,
	check: () => void,
	missingOnly = false,
) {
	let published = false;
	await queueProgressWrite(identity.lessonId, async () => {
		check();
		const db = await getDb();
		check();
		const saved = await db.execute(
			`INSERT INTO flashcard_sets(lesson_id,generation_id,source_hash,source_fingerprint,source_name,
			model,prompt_version,validator_version,notes,usage_json,card_payload)
			SELECT l.id,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10 FROM lessons l JOIN courses c ON c.id=l.course_id
			WHERE l.id=$11 AND c.id=$12 AND l.relative_path=$13 AND c.root_path=$14 AND l.created_at=$15 AND c.created_at=$16 AND l.missing_at IS NULL
			${
				missingOnly
					? "ON CONFLICT(lesson_id) DO NOTHING"
					: `ON CONFLICT(lesson_id) DO UPDATE SET generation_id=excluded.generation_id,source_hash=excluded.source_hash,
			source_fingerprint=excluded.source_fingerprint,source_name=excluded.source_name,model=excluded.model,
			prompt_version=excluded.prompt_version,validator_version=excluded.validator_version,notes=excluded.notes,
			usage_json=excluded.usage_json,card_payload=excluded.card_payload,updated_at=CURRENT_TIMESTAMP`
			}`,
			[
				jobId,
				source.sourceHash,
				source.sourceFingerprint,
				source.filename,
				MODEL,
				PROMPT_VERSION,
				VALIDATOR_VERSION,
				result.notes.join("\n"),
				JSON.stringify(result.usage),
				JSON.stringify(result.cards),
				identity.lessonId,
				identity.courseId,
				identity.relativePath,
				identity.rootPath,
				identity.lessonCreated,
				identity.courseCreated,
			],
		);
		if (!saved.rowsAffected)
			throw new Error(
				"Lesson changed, was removed, or already has a saved set. Existing cards were not replaced.",
			);
		published = true;
	});
	if (!published)
		throw new Error(
			"Flashcard save was discarded because this lesson is being removed.",
		);
}

export function editFlashcard(
	set: FlashcardSet,
	cardId: number,
	question: string,
	answer: string,
	extraContext: string | null,
) {
	const fields = validateEdit(question, answer, extraContext);
	return queueProgressWrite(set.lessonId, async () => {
		const db = await getDb();
		const result = await db.execute(
			`UPDATE flashcards SET question=$1,answer=$2,extra_context=$3,edited=1
			WHERE id=$4 AND set_id IN(SELECT id FROM flashcard_sets WHERE lesson_id=$5 AND generation_id=$6)`,
			[
				fields.question,
				fields.answer,
				fields.extraContext,
				cardId,
				set.lessonId,
				set.generationId,
			],
		);
		if (!result.rowsAffected)
			throw new Error("This card changed. Reopen review.");
	});
}
export function deleteFlashcard(set: FlashcardSet, cardId: number) {
	return queueProgressWrite(set.lessonId, async () => {
		const db = await getDb();
		await db.execute(
			`DELETE FROM flashcards WHERE id=$1 AND set_id IN
			(SELECT id FROM flashcard_sets WHERE lesson_id=$2 AND generation_id=$3)`,
			[cardId, set.lessonId, set.generationId],
		);
	});
}
