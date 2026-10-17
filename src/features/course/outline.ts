import type { CourseOutline, OutlineLesson } from "@/lib/db/courseOutline";

export function sectionName(path: string): string {
	return path.split("/").slice(0, -1).join("/");
}
export function sectionLabel(name: string): string {
	return name ? name.split("/").join(" / ") : "Lessons";
}

export function buildOutline(
	lessons: readonly OutlineLesson[],
	currentId: number,
) {
	const active = lessons
		.filter((lesson) => lesson.missing_at === null)
		.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
	const groups = new Map<string, OutlineLesson[]>();
	for (const lesson of active) {
		const name = sectionName(lesson.relative_path);
		const group = groups.get(name) ?? [];
		group.push(lesson);
		groups.set(name, group);
	}
	const sections = [...groups].map(([name, rows]) => ({
		name,
		label: sectionLabel(name),
		lessons: rows,
		total: rows.length,
		completed: rows.filter((lesson) => lesson.completed).length,
	}));
	const index = active.findIndex((lesson) => lesson.id === currentId);
	const section = sections.find((group) =>
		group.lessons.some((lesson) => lesson.id === currentId),
	);
	const completed = active.filter((lesson) => lesson.completed).length;
	return {
		sections,
		total: active.length,
		completed,
		percent: active.length ? Math.round((100 * completed) / active.length) : 0,
		section,
		position: section
			? section.lessons.findIndex((lesson) => lesson.id === currentId) + 1
			: 0,
		previous: index > 0 ? active[index - 1] : null,
		next: index >= 0 ? (active[index + 1] ?? null) : null,
	};
}

export function parseId(raw: string | undefined): number | null {
	if (!raw || !/^[1-9]\d*$/.test(raw)) return null;
	const value = Number(raw);
	return Number.isSafeInteger(value) ? value : null;
}

export function courseDestination(
	outline: CourseOutline | null,
	rawLessonId: string | undefined,
	resumeId: number | null,
) {
	if (!outline)
		return { kind: "not-found" as const, message: "Course not found." };
	const lessons = outline.lessons.filter(
		(lesson) => lesson.missing_at === null,
	);
	if (rawLessonId !== undefined) {
		const id = parseId(rawLessonId);
		const lesson = lessons.find(
			(row) => row.id === id && row.course_id === outline.course.id,
		);
		return lesson
			? { kind: "lesson" as const, lesson }
			: {
					kind: "not-found" as const,
					message:
						"Lesson not found in this course, or its file is marked missing.",
				};
	}
	if (!lessons.length) return { kind: "empty" as const };
	// Completed courses have no resume target; the first lesson is available for review.
	const target = lessons.find((lesson) => lesson.id === resumeId) ?? lessons[0];
	return { kind: "redirect" as const, lessonId: target.id };
}
