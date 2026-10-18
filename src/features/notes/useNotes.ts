import { useEffect, useSyncExternalStore } from "react";
import { useManagement } from "@/features/course-management/state";
import type { NoteLesson } from "@/features/notes/controller";
import { notesController } from "@/features/notes/store";

export function useNotesSnapshot() {
	useSyncExternalStore(
		notesController.subscribe,
		notesController.getSnapshot,
		notesController.getSnapshot,
	);
	return notesController;
}
export function useNotes(
	courseId: number,
	lessonId: number,
	lessons: readonly NoteLesson[],
) {
	const controller = useNotesSnapshot();
	const { revision } = useManagement();
	const lessonKey = lessons
		.map((lesson) => `${lesson.id}:${lesson.sort_order}:${lesson.title}`)
		.join("|");
	// Outline completion changes are not note reloads.
	// biome-ignore lint/correctness/useExhaustiveDependencies: Reload on course visit, not completion changes.
	useEffect(() => {
		void controller.loadCourse(courseId, lessons);
	}, [courseId, controller, revision, lessonKey]);
	useEffect(() => {
		const saveShortcut = (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
				event.preventDefault();
				void controller.flushCourse(courseId);
			}
		};
		const hidden = () => {
			if (document.hidden) void controller.flushCourse(courseId);
		};
		document.addEventListener("visibilitychange", hidden);
		document.addEventListener("keydown", saveShortcut);
		return () => {
			controller.composition(lessonId, false);
			void controller.flush(lessonId);
			document.removeEventListener("visibilitychange", hidden);
			document.removeEventListener("keydown", saveShortcut);
		};
	}, [controller, courseId, lessonId]);
	return controller;
}
