import type { OutlineLesson } from "@/lib/db/courseOutline";

export function validDuration(
	value: number | null | undefined,
): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function lessonTime(value: number | null | undefined): string {
	if (!validDuration(value)) return "—";
	const seconds = Math.round(value);
	const minutes = Math.floor(seconds / 60);
	return minutes >= 60
		? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
		: `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function sectionTime(
	lessons: readonly Pick<OutlineLesson, "duration_seconds">[],
): string {
	if (
		!lessons.length ||
		lessons.some((row) => !validDuration(row.duration_seconds))
	)
		return "—";
	return totalTime(
		lessons.reduce((sum, row) => sum + (row.duration_seconds ?? 0), 0),
	);
}

export function totalTime(seconds: number | null | undefined): string {
	if (!validDuration(seconds)) return "—";
	const minutes = Math.max(1, Math.round(seconds / 60));
	return minutes >= 60
		? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`
		: `${minutes} min`;
}

// Detached metadata elements never play and never receive progress-tracking handlers.
export function readVideoDuration(
	url: string,
	signal: AbortSignal,
	createVideo = () => document.createElement("video"),
	timeoutMs = 10000,
): Promise<number | null> {
	if (signal.aborted) return Promise.resolve(null);
	return new Promise((resolve) => {
		const video = createVideo();
		const finish = (value: number | null) => {
			clearTimeout(timer);
			signal.removeEventListener("abort", abort);
			video.removeEventListener("loadedmetadata", metadata);
			video.removeEventListener("durationchange", metadata);
			video.removeEventListener("error", fail);
			video.removeAttribute("src");
			video.load();
			resolve(value);
		};
		const metadata = () => {
			if (video.readyState >= 1 && validDuration(video.duration))
				finish(video.duration);
		};
		const fail = () => finish(null);
		const abort = () => finish(null);
		const timer = setTimeout(fail, timeoutMs);
		signal.addEventListener("abort", abort, { once: true });
		video.addEventListener("loadedmetadata", metadata);
		video.addEventListener("durationchange", metadata);
		video.addEventListener("error", fail);
		video.preload = "metadata";
		video.src = url;
		video.load();
	});
}

export async function discoverDurations<
	T extends { duration_seconds?: number | null },
>(
	lessons: readonly T[],
	signal: AbortSignal,
	read: (lesson: T) => Promise<number | null>,
	save: (lesson: T, seconds: number) => Promise<void>,
): Promise<void> {
	const pending = lessons.filter((row) => !validDuration(row.duration_seconds));
	let index = 0;
	async function worker() {
		while (!signal.aborted && index < pending.length) {
			const lesson = pending[index++];
			try {
				const seconds = await read(lesson);
				if (!signal.aborted && validDuration(seconds))
					await save(lesson, seconds);
			} catch {
				// Unavailable media or a failed cache write leaves the duration unknown.
				// Never log a token-bearing media URL.
			}
		}
	}
	await Promise.all([worker(), worker()]);
}
