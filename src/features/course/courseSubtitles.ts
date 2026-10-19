import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import { CourseSubtitleQueue } from "@/features/course/courseSubtitleQueue";
import {
	parseSubtitle,
	type SubtitleSidecar,
} from "@/features/course/subtitleCues";
import {
	loadLessonSubtitle,
	registerGenerationCancellation,
	releaseGeneration,
	reserveGeneration,
	startGeneration,
	waitForGeneration,
} from "@/features/course/subtitleGeneration";
import { getGeneratedSubtitle } from "@/lib/db/generatedSubtitles";
import { listByCourse } from "@/lib/db/lessons";
import { getRegistrationStatus, initializePlayback } from "@/lib/playback";

export const courseSubtitles = new CourseSubtitleQueue({
	reserve: reserveGeneration,
	release: releaseGeneration,
	async lessons(courseId) {
		await initializePlayback();
		const registration = getRegistrationStatus(courseId);
		if (registration?.status !== "registered")
			throw new Error(
				registration?.message ?? "Locate the course folder first.",
			);
		return listByCourse(courseId);
	},
	async sidecar(courseId, lesson) {
		const sidecar = await invoke<SubtitleSidecar | null>(
			"get_lesson_subtitle",
			{ courseId, relativePath: lesson.relative_path },
		);
		if (!sidecar) return false;
		parseSubtitle(sidecar.content);
		return true;
	},
	async cached(courseId, lesson) {
		const subtitle = await loadLessonSubtitle(
			courseId,
			lesson.id,
			lesson.relative_path,
		);
		if (!subtitle) return false;
		parseSubtitle(subtitle.content);
		return true;
	},
	async generate(courseId, lesson, consent, owner) {
		const id = await startGeneration(
			courseId,
			lesson.id,
			lesson.relative_path,
			consent,
			owner,
		);
		await waitForGeneration(id);
	},
	async export(courseId, lesson) {
		const metadata = await getGeneratedSubtitle(lesson.id);
		if (!metadata) throw new Error("Generated subtitle cache is unavailable.");
		return invoke<"saved" | "existing">("export_generated_subtitle", {
			courseId,
			relativePath: lesson.relative_path,
			metadata,
		});
	},
});
const stopCancellation = registerGenerationCancellation(courseSubtitles.cancel);
if (import.meta.hot)
	import.meta.hot.dispose(() => {
		void courseSubtitles.cancel();
		stopCancellation();
	});
export function useCourseSubtitles() {
	return useSyncExternalStore(
		courseSubtitles.subscribe,
		courseSubtitles.getSnapshot,
	);
}
