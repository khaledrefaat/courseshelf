import { useEffect, useRef, useState } from "react";
import {
	discoverDurations,
	readVideoDuration,
} from "@/features/course/durations";
import { persistCompletion } from "@/features/course/progressActions";
import { useManagement } from "@/features/course-management/state";
import { type CourseOutline, getCourseOutline } from "@/lib/db/courseOutline";
import { listCourseSummaries } from "@/lib/db/courseSummaries";
import { durationRevision, saveDuration } from "@/lib/db/durations";
import { getLessonUrl } from "@/lib/playback";

export function useCourse(courseId: number) {
	const { revision } = useManagement();
	const [data, setData] = useState<{
		outline: CourseOutline | null;
		resumeId: number | null;
	} | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [progressError, setProgressError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const busy = useRef(new Set<number>());
	const mounted = useRef(true);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Management mutations explicitly invalidate this query.
	useEffect(() => {
		let active = true;
		const abort = new AbortController();
		mounted.current = true;
		void Promise.all([getCourseOutline(courseId), listCourseSummaries()])
			.then(([outline, summaries]) => {
				if (active)
					setData({
						outline,
						resumeId:
							summaries.find((course) => course.id === courseId)
								?.resume_lesson_id ?? null,
					});
				if (active && outline) {
					const cacheRevision = durationRevision(courseId);
					void discoverDurations(
						outline.lessons,
						abort.signal,
						async (row) =>
							readVideoDuration(
								await getLessonUrl(courseId, row.relative_path),
								abort.signal,
							),
						async (lesson, seconds) => {
							if (!active) return;
							const saved = await saveDuration(
								courseId,
								lesson.id,
								seconds,
								cacheRevision,
							);
							if (active && saved)
								setData((previous) =>
									previous?.outline
										? {
												...previous,
												outline: {
													...previous.outline,
													lessons: previous.outline.lessons.map((row) =>
														row.id === lesson.id
															? { ...row, duration_seconds: seconds }
															: row,
													),
												},
											}
										: previous,
								);
						},
					);
				}
			})
			.catch(() => {
				if (active)
					setError(
						"Could not load this course. Please return to the Library and try again.",
					);
			});
		return () => {
			active = false;
			abort.abort();
			mounted.current = false;
		};
	}, [courseId, revision]);
	async function changeCompletion(lessonId: number, desired?: boolean) {
		const lesson = data?.outline?.lessons.find((row) => row.id === lessonId);
		if (!lesson || busy.current.has(lessonId)) return;
		if (desired !== undefined && desired === lesson.completed) return;
		busy.current.add(lessonId);
		setSaving(true);
		setProgressError(null);
		try {
			await persistCompletion(lessonId, lesson.completed, (completed) => {
				if (mounted.current)
					setData((previous) =>
						previous?.outline
							? {
									...previous,
									outline: {
										...previous.outline,
										lessons: previous.outline.lessons.map((row) =>
											row.id === lessonId ? { ...row, completed } : row,
										),
									},
								}
							: previous,
					);
			});
		} catch {
			if (mounted.current)
				setProgressError(
					"Could not update completion. Your change was reverted. Please try again.",
				);
		} finally {
			busy.current.delete(lessonId);
			if (mounted.current) setSaving(busy.current.size > 0);
		}
	}
	return {
		data,
		error,
		progressError,
		saving,
		toggleCompletion: (id: number) => changeCompletion(id),
		completeLesson: (id: number) => changeCompletion(id, true),
	};
}
