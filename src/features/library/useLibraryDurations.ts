import { useEffect, useState } from "react";
import { readVideoDuration } from "@/features/course/durations";
import {
	discoverLibraryDurations,
	durationCourseIds,
} from "@/features/library/durations";
import type { CourseSummary } from "@/lib/db/courseSummaries";
import {
	durationRevision,
	getCourseDuration,
	listUncachedDurations,
	saveDuration,
} from "@/lib/db/durations";
import { getLessonUrl, type RegistrationStatus } from "@/lib/playback";

export function useLibraryDurations(
	courses: readonly CourseSummary[],
	registrations: ReadonlyMap<number, Readonly<RegistrationStatus>>,
	loadedRevision: number,
	busy: boolean,
	changed: (courseId: number, seconds: number | null) => void,
) {
	const [visible, setVisible] = useState(
		() =>
			typeof document === "undefined" || document.visibilityState !== "hidden",
	);
	useEffect(() => {
		const visibility = () => setVisible(document.visibilityState !== "hidden");
		document.addEventListener("visibilitychange", visibility);
		return () => document.removeEventListener("visibilitychange", visibility);
	}, []);
	const ids = courses.map((course) => course.id).join(",");
	// biome-ignore lint/correctness/useExhaustiveDependencies: IDs and query revision own the batch. Updating cached totals must not restart it and re-read failed files.
	useEffect(() => {
		if (busy || !visible) return;
		const abort = new AbortController();
		const pending = durationCourseIds(courses, registrations);
		// Let the grid paint and avoid opening media during rapid filtering/navigation.
		const timer = setTimeout(() => {
			void discoverLibraryDurations(pending, abort.signal, {
				revision: durationRevision,
				lessons: listUncachedDurations,
				read: async (row, signal) =>
					readVideoDuration(
						await getLessonUrl(row.course_id, row.relative_path),
						signal,
					),
				save: (row, seconds, revision) =>
					saveDuration(row.course_id, row.id, seconds, revision),
				total: getCourseDuration,
				changed,
			});
		}, 200);
		return () => {
			clearTimeout(timer);
			abort.abort();
		};
	}, [ids, loadedRevision, registrations, busy, visible, changed]);
}
