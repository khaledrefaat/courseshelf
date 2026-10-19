import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import {
	parseSubtitle,
	type SubtitleSidecar,
} from "@/features/course/subtitleCues";
import {
	type GeneratedSubtitle,
	getGeneratedSubtitle,
	listGeneratedSubtitles,
	removeGeneratedSubtitle,
	saveGeneratedSubtitle,
} from "@/lib/db/generatedSubtitles";
import { queueProgressWrite } from "@/lib/db/progressWrites";

export interface GenerationJob {
	id: string;
	courseId: number;
	lessonId: number;
	stage: string;
	progress: number | null;
	running: boolean;
	result: GeneratedSubtitle | null;
	error: string | null;
}
export interface GenerationStatus {
	modelPresent: boolean;
	ffmpegPresent: boolean;
	ffmpegDownloadBytes: number;
	helpersPresent: boolean;
	job: GenerationJob | null;
}
let state: { status: GenerationStatus | null; error: string | null } = {
	status: null,
	error: null,
};
let revision = 0;
const lessonRevisions = new Map<number, number>();
const listeners = new Set<() => void>();
const blockedCourses = new Set<number>();
const requested = new Map<
	string,
	{ courseId: number; lessonId: number; relativePath: string }
>();
let timer: ReturnType<typeof setTimeout> | undefined;
let polling: Promise<void> | undefined;
let finalizing: Promise<void> | undefined;
let stopped = false;
let reservation: symbol | undefined;
let starting = false;
let cancelAllRevision = 0;
const cancelRevisions = new Map<number, number>();
let outcome:
	| { id: string; result?: GeneratedSubtitle; error?: string }
	| undefined;
const cancellationListeners = new Set<
	(courseId?: number) => Promise<void> | void
>();
export function reserveGeneration() {
	if (
		reservation ||
		starting ||
		state.status?.job?.running ||
		state.status?.job?.result
	)
		throw new Error("Another subtitle job is running. Cancel it or wait.");
	reservation = Symbol("course subtitles");
	return reservation;
}
export function releaseGeneration(owner: symbol) {
	if (reservation === owner) reservation = undefined;
}
export function registerGenerationCancellation(
	listener: (courseId?: number) => Promise<void> | void,
) {
	cancellationListeners.add(listener);
	return () => {
		cancellationListeners.delete(listener);
	};
}
export function waitForGeneration(id: string): Promise<GeneratedSubtitle> {
	return new Promise((resolve, reject) => {
		const check = () => {
			const job = state.status?.job;
			if (outcome?.id === id) {
				unsubscribe();
				if (outcome.result) resolve(outcome.result);
				else reject(new Error(outcome.error));
			} else if (job?.id === id && !job.running && !job.result) {
				unsubscribe();
				reject(new Error(job.error ?? "Subtitle job was cancelled."));
			} else if (state.error && !job?.running && !job?.result) {
				unsubscribe();
				reject(new Error(state.error));
			}
		};
		const unsubscribe = subscribe(check);
		check();
	});
}
const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};
const emit = () => {
	for (const listener of listeners) listener();
};
function publish(next: typeof state) {
	if (JSON.stringify(next) !== JSON.stringify(state)) {
		state = next;
		emit();
	}
}
const message = (error: unknown) =>
	error instanceof Error
		? error.message
		: typeof error === "string"
			? error
			: "Subtitle generation failed. Please retry.";

export function useSubtitleGeneration() {
	return useSyncExternalStore(subscribe, () => state);
}
export function useSubtitleRevision(lessonId?: number) {
	return useSyncExternalStore(subscribe, () =>
		lessonId === undefined ? revision : (lessonRevisions.get(lessonId) ?? 0),
	);
}

async function removeFile(row: GeneratedSubtitle) {
	await invoke("remove_generated_subtitle", {
		lessonId: row.lessonId,
		filename: row.filename,
	});
}

async function finish(job: GenerationJob) {
	const row = job.result;
	if (!row) return;
	const input = requested.get(job.id);
	let previous: GeneratedSubtitle | null = null;
	try {
		if (!input || blockedCourses.has(job.courseId))
			throw new Error("Subtitle job was cancelled before saving.");
		const old = await getGeneratedSubtitle(row.lessonId);
		previous = old;
		let committed = false;
		// Validate native output through the same bounded cue parser before committing.
		await invoke("validate_generated_subtitle_job", { jobId: job.id }).then(
			(content) => parseSubtitle(String(content)),
		);
		await queueProgressWrite(row.lessonId, async () => {
			if (blockedCourses.has(job.courseId))
				throw new Error("Course is being removed.");
			await saveGeneratedSubtitle(input.courseId, input.relativePath, row);
			if (blockedCourses.has(job.courseId))
				throw new Error("Course is being removed.");
			await invoke("finish_subtitle_generation", { jobId: job.id, keep: true });
			committed = true;
		});
		if (!committed)
			throw new Error("Course was removed before subtitles could be saved.");
		if (old && old.filename !== row.filename)
			await removeFile(old).catch(() => {
				publish({
					...state,
					error:
						"Subtitles saved, but an older cache file could not be removed.",
				});
			});
		revision++;
		lessonRevisions.set(
			row.lessonId,
			(lessonRevisions.get(row.lessonId) ?? 0) + 1,
		);
		outcome = { id: job.id, result: row };
		emit();
	} catch (error) {
		let detail = message(error);
		try {
			await removeGeneratedSubtitle(row.lessonId, row.filename);
			if (previous && input && !blockedCourses.has(job.courseId))
				await saveGeneratedSubtitle(
					input.courseId,
					input.relativePath,
					previous,
				);
		} catch {
			detail += " Metadata rollback also failed.";
		}
		try {
			await invoke("finish_subtitle_generation", {
				jobId: job.id,
				keep: false,
			});
		} catch {
			detail +=
				" Temporary cleanup also failed; restart the app before retrying.";
		}
		outcome = { id: job.id, error: detail };
		publish({ ...state, error: detail });
		emit();
	} finally {
		requested.delete(job.id);
	}
}

export function pollGeneration(): Promise<void> {
	if (polling) return polling;
	polling = (async () => {
		try {
			const status = await invoke<GenerationStatus>(
				"subtitle_generation_status",
			);
			publish({ ...state, status });
			if (status.job?.result && !status.job.running) {
				finalizing = finish(status.job);
				await finalizing;
				finalizing = undefined;
				publish({
					...state,
					status: await invoke<GenerationStatus>("subtitle_generation_status"),
				});
			}
		} catch (error) {
			publish({ ...state, error: message(error) });
		}
	})().finally(() => {
		polling = undefined;
		if (!stopped && (state.status?.job?.running || state.status?.job?.result))
			timer = setTimeout(() => {
				void pollGeneration();
			}, 750);
	});
	return polling;
}

export function initializeSubtitleGeneration() {
	stopped = false;
	void pollGeneration();
	return () => {
		stopped = true;
		clearTimeout(timer);
	};
}

export async function startGeneration(
	courseId: number,
	lessonId: number,
	relativePath: string,
	downloadConsent: boolean,
	owner?: symbol,
) {
	if (reservation && reservation !== owner)
		throw new Error("A course subtitle queue is running. Cancel it or wait.");
	if (blockedCourses.has(courseId))
		throw new Error("This course is being removed.");
	if (starting) throw new Error("A subtitle job is starting. Please wait.");
	starting = true;
	const globalVersion = cancelAllRevision;
	const courseVersion = cancelRevisions.get(courseId);
	const cancelled = () =>
		globalVersion !== cancelAllRevision ||
		courseVersion !== cancelRevisions.get(courseId) ||
		blockedCourses.has(courseId);
	try {
		clearTimeout(timer);
		await polling;
		if (cancelled())
			throw new Error("Subtitle job was cancelled before starting.");
		publish({ ...state, error: null });
		const id = await invoke<string>("start_subtitle_generation", {
			courseId,
			lessonId,
			relativePath,
			downloadConsent,
		});
		outcome = undefined;
		if (cancelled()) {
			await invoke("cancel_subtitle_generation", { jobId: id, courseId });
			await pollGeneration();
			throw new Error("Subtitle job was cancelled while starting.");
		}
		requested.set(id, { courseId, lessonId, relativePath });
		await pollGeneration();
		return id;
	} finally {
		starting = false;
	}
}

export async function cancelGeneration(courseId?: number) {
	if (courseId === undefined) cancelAllRevision++;
	else cancelRevisions.set(courseId, (cancelRevisions.get(courseId) ?? 0) + 1);
	const waiting = [...cancellationListeners].map((listener) =>
		listener(courseId),
	);
	for (const [id, input] of requested) {
		if (courseId === undefined || input.courseId === courseId)
			requested.delete(id);
	}
	await invoke("cancel_subtitle_generation", {
		courseId: courseId ?? null,
		jobId: null,
	});
	await finalizing;
	await pollGeneration();
	await Promise.all(waiting);
}

export async function loadLessonSubtitle(
	courseId: number,
	lessonId: number,
	relativePath: string,
): Promise<SubtitleSidecar | null> {
	const sidecar = await invoke<SubtitleSidecar | null>("get_lesson_subtitle", {
		courseId,
		relativePath,
	});
	if (sidecar) return sidecar;
	const metadata = await getGeneratedSubtitle(lessonId);
	if (!metadata) return null;
	const content = await invoke<string | null>("read_generated_subtitle", {
		courseId,
		relativePath,
		metadata,
	});
	if (content !== null) return { filename: metadata.filename, content };
	await removeGeneratedSubtitle(lessonId, metadata.filename);
	await removeFile(metadata);
	return null;
}

export async function prepareSubtitleRemoval(
	courseId: number,
): Promise<GeneratedSubtitle[]> {
	blockedCourses.add(courseId);
	await cancelGeneration(courseId);
	await finalizing;
	return listGeneratedSubtitles(courseId);
}
export function allowSubtitleGeneration(courseId: number) {
	blockedCourses.delete(courseId);
}
export async function cleanupGeneratedSubtitles(
	rows: readonly GeneratedSubtitle[],
): Promise<string | null> {
	let failed = false;
	for (const row of rows) {
		try {
			await removeFile(row);
		} catch {
			failed = true;
		}
	}
	return failed
		? "Some generated subtitle cache files could not be removed."
		: null;
}
