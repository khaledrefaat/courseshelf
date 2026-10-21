import { discoverDurations, validDuration } from "@/features/course/durations";
import type { CourseSummary } from "@/lib/db/courseSummaries";
import type { DurationLesson } from "@/lib/db/durations";
import type { RegistrationStatus } from "@/lib/playback";

export function durationCourseIds(
	courses: readonly Pick<CourseSummary, "id" | "duration_seconds">[],
	registrations: ReadonlyMap<number, Readonly<RegistrationStatus>>,
) {
	return courses
		.filter(
			(course) =>
				!validDuration(course.duration_seconds) &&
				registrations.get(course.id)?.status === "registered",
		)
		.map((course) => course.id);
}

export interface LibraryDurationDependencies {
	revision(courseId: number): number;
	lessons(courseId: number): Promise<DurationLesson[]>;
	read(lesson: DurationLesson, signal: AbortSignal): Promise<number | null>;
	save(
		lesson: DurationLesson,
		seconds: number,
		revision: number,
	): Promise<boolean>;
	total(courseId: number): Promise<number | null>;
	changed(courseId: number, seconds: number | null): void;
}

// One course at a time, two metadata reads across the entire visible grid, not
// two per card. Only IDs and missing lesson metadata are loaded; never play media.
export async function discoverLibraryDurations(
	courseIds: readonly number[],
	signal: AbortSignal,
	deps: LibraryDurationDependencies,
) {
	for (const courseId of courseIds) {
		if (signal.aborted) return;
		const revision = deps.revision(courseId);
		const current = () =>
			!signal.aborted && deps.revision(courseId) === revision;
		try {
			const lessons = await deps.lessons(courseId);
			if (!current()) continue;
			await discoverDurations(
				lessons,
				signal,
				(row) => (current() ? deps.read(row, signal) : Promise.resolve(null)),
				async (row, seconds) => {
					if (current()) await deps.save(row, seconds, revision);
				},
			);
			if (!current()) continue;
			const total = await deps.total(courseId);
			if (current()) deps.changed(courseId, total);
		} catch {
			// Missing drives/codecs or cache errors leave an honest unknown total.
			// Never log URLs, retry in a loop, or fail the rest of the Library.
		}
	}
}
