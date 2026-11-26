import { expect, it } from "vitest";
import { subtitleDownloads } from "@/features/course/subtitleDownloads";
import type { GenerationStatus } from "@/features/course/subtitleGeneration";

const ready: GenerationStatus = {
	modelPresent: true,
	ffmpegPresent: true,
	ffmpegDownloadBytes: 135188284,
	helpersPresent: true,
	job: null,
};
it("requests consent only for missing downloads, with platform-specific sizes", () => {
	expect(subtitleDownloads(ready)).toEqual([]);
	expect(subtitleDownloads({ ...ready, ffmpegPresent: false })).toEqual([
		"FFmpeg audio tool (~129 MiB)",
	]);
	expect(subtitleDownloads({ ...ready, modelPresent: false })).toEqual([
		"English model (~142 MiB)",
	]);
	expect(
		subtitleDownloads({
			...ready,
			ffmpegPresent: false,
			modelPresent: false,
			ffmpegDownloadBytes: 167778744,
		}),
	).toEqual(["FFmpeg audio tool (~161 MiB)", "English model (~142 MiB)"]);
	expect(subtitleDownloads(null)).toHaveLength(2);
});
it("asks again before repairing invalid tools or models", () => {
	const job = {
		id: "test",
		courseId: 1,
		lessonId: 1,
		stage: "Failed",
		running: false,
		result: null,
		progress: null,
		error: "FFmpeg is missing or invalid. Confirm its download to continue.",
	};
	expect(subtitleDownloads({ ...ready, job })).toEqual([
		"FFmpeg audio tool (~129 MiB)",
	]);
	expect(
		subtitleDownloads({ ...ready, job: { ...job, error: "Model is invalid" } }),
	).toEqual(["English model (~142 MiB)"]);
});
