import * as courses from "@/lib/db/courses";
import { getDb } from "@/lib/db/db";
import * as lessons from "@/lib/db/lessons";
import * as notes from "@/lib/db/notes";
import * as progress from "@/lib/db/progress";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`DB dev check failed: ${message}`);
}

let check: Promise<void> | undefined;

export function runDevCheck(): Promise<void> {
	check ??= checkDatabase();
	return check;
}

async function checkDatabase(): Promise<void> {
	const course = await courses.create({
		title: "Temporary database check",
		root_path: `courseshelf-dev-check://${crypto.randomUUID()}`,
	});
	let lessonIds: number[] = [];
	try {
		const input: lessons.LessonInput[] = [
			{
				relative_path: "Section 1/Lesson 2.mp4",
				title: "Lesson 2",
				sort_order: 0,
			},
			{
				relative_path: "Section 1/Lesson 10.mp4",
				title: "Lesson 10",
				sort_order: 0,
			},
		];
		await lessons.upsertMany(course.id, input);
		const initial = await lessons.listByCourse(course.id);
		lessonIds = initial.map((lesson) => lesson.id);
		const [first, second] = initial;
		assert(initial.length === 2 && first && second, "two lessons created");
		assert(
			first.relative_path === input[0].relative_path,
			"natural lesson ordering",
		);
		assert(
			(await progress.get(first.id)) === null,
			"missing progress returns null",
		);
		assert((await notes.get(first.id)) === null, "missing note returns null");

		// Exercise each progress helper both as an insert and as an update.
		await progress.setCompleted(first.id, true);
		await progress.savePosition(first.id, 42.5);
		await progress.savePosition(second.id, 12.25);
		const beforeCompletion = await progress.get(second.id);
		await progress.setCompleted(second.id, true);
		await progress.setCompleted(second.id, false);
		await notes.save(first.id, "Original note");
		await notes.save(first.id, "A note with 'quotes' and $1 stays literal.");
		const beforeProgress = await progress.get(first.id);
		const beforeNote = await notes.get(first.id);
		const secondProgress = await progress.get(second.id);
		assert(
			beforeProgress?.completed &&
				beforeProgress.last_position_seconds === 42.5,
			"savePosition preserves completion",
		);
		assert(
			secondProgress?.last_position_seconds === 12.25 &&
				!secondProgress.completed,
			"setCompleted preserves position",
		);
		assert(
			secondProgress.last_watched_at === beforeCompletion?.last_watched_at,
			"setCompleted preserves watched timestamp",
		);
		assert(
			beforeNote?.content === "A note with 'quotes' and $1 stays literal.",
			"note upsert preserves bound content",
		);

		await lessons.upsertMany(
			course.id,
			input.map((lesson) => ({ ...lesson, title: `${lesson.title} updated` })),
		);
		const rescanned = await lessons.listByCourse(course.id);
		assert(
			rescanned.length === 2 &&
				rescanned.every(
					(lesson, index) =>
						lesson.id === initial[index]?.id &&
						lesson.created_at === initial[index]?.created_at &&
						lesson.title.endsWith(" updated"),
				),
			"rescan preserves lesson IDs and creation times",
		);
		const afterProgress = await progress.get(first.id);
		const afterNote = await notes.get(first.id);
		assert(
			JSON.stringify(beforeProgress) === JSON.stringify(afterProgress),
			"rescan preserves progress",
		);
		assert(
			JSON.stringify(beforeNote) === JSON.stringify(afterNote),
			"rescan preserves notes",
		);
		const summary = await progress.getCourseSummary(course.id);
		assert(
			summary.completed_count === 1 && summary.total_count === 2,
			"course summary",
		);
		const readCourse = await courses.getById(course.id);
		assert(readCourse?.root_path === course.root_path, "course readback");
		assert(
			(await courses.list()).some((item) => item.id === course.id),
			"course list",
		);
		console.log("[db dev check] readback", {
			course: readCourse,
			lessons: rescanned,
			progress: afterProgress,
			secondProgress,
			note: afterNote,
			summary,
		});
	} finally {
		// Even a failed assertion must not leave the fixture course behind.
		await courses.delete(course.id);
		assert(
			(await courses.getById(course.id)) === null,
			"fixture course deleted",
		);
		assert(
			(await lessons.listByCourse(course.id)).length === 0,
			"lesson cascade delete",
		);
		for (const lessonId of lessonIds) {
			assert(
				(await progress.get(lessonId)) === null,
				"progress cascade delete",
			);
			assert((await notes.get(lessonId)) === null, "note cascade delete");
		}
		// Also check orphan counts directly if a failure occurred before IDs were read.
		const db = await getDb();
		const [orphans] = await db.select<{ count: number }[]>(
			`SELECT
			 (SELECT COUNT(*) FROM progress LEFT JOIN lessons ON lessons.id = progress.lesson_id WHERE lessons.id IS NULL)
			 + (SELECT COUNT(*) FROM notes LEFT JOIN lessons ON lessons.id = notes.lesson_id WHERE lessons.id IS NULL) AS count`,
		);
		assert(orphans?.count === 0, "no orphan progress or notes");
		console.log(
			"[db dev check] cleanup PASS: fixture course, lessons, progress and notes removed",
		);
	}
	console.log("[db dev check] PASS");
}
