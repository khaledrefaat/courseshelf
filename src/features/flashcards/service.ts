import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import {
	BatchStopped,
	CourseFlashcardQueue,
	type PreparedLesson,
	type RequestObserver,
} from "@/features/flashcards/courseQueue";
import {
	type FlashcardLesson,
	flashcardLesson,
	flashcardStamp,
	saveFlashcards,
} from "@/lib/db/flashcards";
import { getGeneratedSubtitle } from "@/lib/db/generatedSubtitles";
import { listByCourse } from "@/lib/db/lessons";
import {
	canResume,
	generate,
	type Preparation,
	plan,
	type Reply,
	validateReceived,
} from "@/lib/flashcards/pipeline";

interface JobState {
	courseId: number;
	lessonId: number;
	running: boolean;
	stage: string;
	error: string | null;
	warning: string | null;
}
interface Snapshot {
	job: JobState | null;
	revision: number;
	keyReady: boolean;
}
let snapshot: Snapshot = { job: null, revision: 0, keyReady: false };
const listeners = new Set<() => void>();
function publish(change: Partial<Snapshot>) {
	snapshot = { ...snapshot, ...change };
	for (const listener of listeners) listener();
}
export function refreshFlashcards() {
	publish({ revision: snapshot.revision + 1 });
}
export function useFlashcards() {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		() => snapshot,
	);
}
export function flashcardSnapshot() {
	return snapshot;
}
const blocked = new Set<number>();
let owner: symbol | null = null;
let cancellation = 0;
const courseCancellations = new Map<number, number>();
function courseGuard(courseId: number) {
	const global = cancellation,
		local = courseCancellations.get(courseId);
	return () => {
		if (
			blocked.has(courseId) ||
			global !== cancellation ||
			local !== courseCancellations.get(courseId)
		)
			throw new Error("Course or session changed. Preview flashcards again.");
	};
}
interface Run {
	identity: FlashcardLesson;
	cancelled: boolean;
	jobId: string | null;
	task: Promise<void>;
}
let running: Run | null = null;
const message = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

export async function sessionKey(key: string | null = null) {
	// Forget/replacement must also stop queued work BETWEEN individual jobs.
	if (key === "" || (key !== null && (owner || running)))
		await cancelFlashcards();
	const ready = await invoke<boolean>("flashcards_key", { key });
	publish({ keyReady: ready });
	return ready;
}

export async function prepareFlashcards(
	courseId: number,
	lessonId: number,
	inspectCheckpoint = true,
) {
	if (blocked.has(courseId))
		throw new Error("Course management is in progress.");
	const identity = await flashcardLesson(courseId, lessonId);
	const generated = await getGeneratedSubtitle(lessonId);
	const prepared = await invoke<Preparation>("flashcards_prepare", {
		inspectCheckpoint,
		lesson: {
			courseId,
			lessonId,
			relativePath: identity.relativePath,
			generated,
		},
	});
	if (blocked.has(courseId))
		throw new Error("Course changed while preparing flashcards.");
	plan(prepared.source);
	return { identity, prepared };
}
export type { PreparedLesson } from "@/features/flashcards/courseQueue";

export function startFlashcards(
	input: PreparedLesson,
	resume: boolean,
	batch?: { owner: symbol; observer: RequestObserver },
): Promise<void> {
	if (
		running ||
		blocked.has(input.identity.courseId) ||
		(owner !== null && batch?.owner !== owner) ||
		(batch && batch.owner !== owner)
	)
		return Promise.reject(
			new Error("Another flashcard job or course operation is active."),
		);
	const run: Run = {
		identity: input.identity,
		cancelled: false,
		jobId: null,
		task: Promise.resolve(),
	};
	running = run;
	const job: JobState = {
		courseId: run.identity.courseId,
		lessonId: run.identity.lessonId,
		running: true,
		stage: "Preparing flashcards",
		error: null,
		warning: null,
	};
	publish({ job });
	const update = (patch: Partial<JobState>) =>
		publish({ job: { ...job, ...snapshot.job, ...patch } });
	const check = () => {
		batch?.observer.check();
		if (run.cancelled || running !== run || blocked.has(run.identity.courseId))
			throw new Error(
				"Flashcard generation cancelled. Existing cards were kept; in-flight usage may still be charged.",
			);
	};
	run.task = (async () => {
		let saved = false;
		try {
			const reused = resume ? (input.prepared.resume?.replies ?? []) : [];
			if (resume && !canResume(input.prepared, input.identity))
				throw new Error(
					"Checkpoint cannot be resumed safely. No requests were sent.",
				);
			validateReceived(input.prepared.source, reused);
			for (const reply of reused) batch?.observer.reply(reply.usage, true);
			const currentPlan = plan(input.prepared.source);
			check();
			try {
				run.jobId = await invoke<string>("flashcards_begin", {
					preparedId: input.prepared.id,
					sections: currentPlan.bounds,
					resume,
				});
			} catch (cause) {
				if (batch) throw new BatchStopped(message(cause));
				throw cause;
			}
			check();
			const result = await generate(
				input.prepared.source,
				reused,
				async (stage, messages) => {
					check();
					update({
						stage:
							stage === "selection"
								? "Selecting whole-lesson cards"
								: `Extracting section ${stage.slice(8)} of ${currentPlan.sections.length}`,
					});
					batch?.observer.request();
					let reply: Reply;
					try {
						reply = await invoke<Reply>("flashcards_request", {
							jobId: run.jobId,
							stage,
							messages,
						});
					} catch (cause) {
						// Any native request/transport rejection stops a batch. Do not
						// guess auth/quota/network categories from provider error text.
						if (batch) throw new BatchStopped(message(cause));
						throw cause;
					}
					batch?.observer.reply(reply.usage, false);
					return reply;
				},
				check,
			);
			check();
			update({ stage: "Checking source and saving cards" });
			await invoke("flashcards_validate_job", { jobId: run.jobId });
			check();
			await saveFlashcards(
				run.identity,
				run.jobId,
				input.prepared.source,
				result,
				check,
				!!batch,
			);
			// Once the atomic SQL statement committed, cancellation cannot undo it.
			// Removal waits for this task, then cascades these rows normally.
			saved = true;
			batch?.observer.saved();
			update({ stage: `Saved ${result.cards.length} flashcards` });
		} catch (error) {
			update({
				error: message(error),
				stage: run.cancelled ? "Cancelled" : "Generation stopped",
			});
			throw error;
		} finally {
			if (run.jobId) {
				try {
					await invoke("flashcards_finish", { jobId: run.jobId, saved });
				} catch {
					update({
						warning:
							"Checkpoint cleanup/finalization failed. Saved cards are retained; restart before generating again.",
					});
				}
			}
			if (running === run) running = null;
			update({ running: false });
			refreshFlashcards();
		}
	})();
	return run.task;
}

export async function cancelFlashcards(
	courseId: number | null = null,
): Promise<void> {
	if (courseId === null) cancellation++;
	else
		courseCancellations.set(
			courseId,
			(courseCancellations.get(courseId) ?? 0) + 1,
		);
	const queued = courseFlashcards.cancel(courseId);
	const own =
		running && (courseId === null || running.identity.courseId === courseId)
			? running
			: null;
	if (own) own.cancelled = true;
	await invoke("flashcards_cancel", { courseId });
	await own?.task.catch(() => {});
	await queued;
}

// Block synchronously before the first await, including the final DB save.
export async function pauseCourseFlashcards(courseId: number) {
	blocked.add(courseId);
	try {
		await cancelFlashcards(courseId);
	} catch (error) {
		blocked.delete(courseId);
		throw error;
	}
}
export function allowCourseFlashcards(courseId: number) {
	blocked.delete(courseId);
}
export async function withFlashcardsPaused<T>(
	courseId: number,
	action: () => Promise<T>,
) {
	await pauseCourseFlashcards(courseId);
	try {
		return await action();
	} finally {
		allowCourseFlashcards(courseId);
	}
}
export async function cleanupCourseFlashcards(
	courseId: number,
): Promise<string | null> {
	try {
		await invoke("flashcards_discard", { courseId, lessonId: null });
		return null;
	} catch {
		return "Course removed, but private flashcard checkpoints could not be cleaned up.";
	}
}
export async function discardCheckpoint(courseId: number, lessonId: number) {
	if (owner || running)
		throw new Error(
			"Cancel flashcard generation before discarding checkpoints.",
		);
	await invoke("flashcards_discard", { courseId, lessonId });
	refreshFlashcards();
}

export const courseFlashcards = new CourseFlashcardQueue({
	reserve(courseId) {
		if (owner || running || blocked.has(courseId))
			throw new Error("Another flashcard job or course operation is active.");
		owner = Symbol("course-flashcards");
		return owner;
	},
	release(token) {
		if (owner === token) owner = null;
	},
	guard: courseGuard,
	lessons: (courseId) => listByCourse(courseId),
	saved: (lessonId) => flashcardStamp(lessonId),
	prepare: prepareFlashcards,
	async generate(input, resume, token, observer) {
		await startFlashcards(input, resume, { owner: token, observer });
		if (snapshot.job?.warning) throw new BatchStopped(snapshot.job.warning);
	},
});
export function useCourseFlashcards() {
	return useSyncExternalStore(
		courseFlashcards.subscribe,
		courseFlashcards.getSnapshot,
	);
}

if (import.meta.hot)
	import.meta.hot.dispose(() => {
		void cancelFlashcards().catch(() => {});
	});
