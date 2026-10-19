import type { GenerationStatus } from "@/features/course/subtitleGeneration";

export function subtitleDownloads(status: GenerationStatus | null): string[] {
	const downloads: string[] = [];
	const error = status?.job?.error ?? "";
	if (
		!status?.ffmpegPresent ||
		/ffmpeg.*missing|ffmpeg.*invalid/i.test(error)
	) {
		const size = status
			? Math.ceil(status.ffmpegDownloadBytes / 1024 ** 2)
			: null;
		downloads.push(
			`FFmpeg audio tool (${size ? `~${size} MiB` : "size checked before starting"})`,
		);
	}
	if (!status?.modelPresent || /model.*missing|model.*invalid/i.test(error))
		downloads.push("English model (~142 MiB)");
	return downloads;
}
