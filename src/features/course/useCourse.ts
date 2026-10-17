import { useEffect, useRef, useState } from "react";
import { persistCompletion } from "@/features/course/progressActions";
import { type CourseOutline, getCourseOutline } from "@/lib/db/courseOutline";
import { listCourseSummaries } from "@/lib/db/courseSummaries";

export function useCourse(courseId: number) {
	const [data, setData] = useState<{
		outline: CourseOutline | null;
		resumeId: number | null;
	} | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [progressError, setProgressError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const busy = useRef(false);
	const mounted = useRef(true);
	useEffect(() => {
		let active = true;
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
			})
			.catch(() => {
				if (active)
					setError(
						"Could not load this course. Please return to the Library and try again.",
					);
			});
		return () => {
			active = false;
			mounted.current = false;
		};
	}, [courseId]);
	async function toggleCompletion(lessonId: number) {
		const lesson = data?.outline?.lessons.find((row) => row.id === lessonId);
		if (!lesson || busy.current) return;
		busy.current = true;
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
			busy.current = false;
			if (mounted.current) setSaving(false);
		}
	}
	return { data, error, progressError, saving, toggleCompletion };
}
