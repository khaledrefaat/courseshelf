import type { FlashcardLesson } from "@/lib/db/flashcards";
import {
	canResume,
	type Preparation,
	remainingRequests,
	type Usage,
} from "@/lib/flashcards/pipeline";

export interface PreparedLesson {
	identity: FlashcardLesson;
	prepared: Preparation;
}
export interface CourseLesson {
	id: number;
	title: string;
}
export interface CourseItem extends CourseLesson {
	status: "ready" | "saved" | "issue";
	reason: string;
	signature: string;
	requests: number;
	reused: number;
}
export interface CoursePlan {
	courseId: number;
	title: string;
	items: readonly CourseItem[];
	maximumRequests: number;
	check(): void;
}
export interface RequestObserver {
	check(): void;
	request(): void;
	reply(usage: Usage | null, reused: boolean): void;
	saved(): void;
}
export class BatchStopped extends Error {}
export interface CourseQueueDependencies {
	reserve(courseId: number): symbol;
	release(owner: symbol): void;
	guard(courseId: number): () => void;
	lessons(courseId: number): Promise<CourseLesson[]>;
	saved(lessonId: number): Promise<{
		sourceHash: string;
		sourceFingerprint: string;
	} | null>;
	prepare(
		courseId: number,
		lessonId: number,
		inspect?: boolean,
	): Promise<PreparedLesson>;
	generate(
		input: PreparedLesson,
		resume: boolean,
		owner: symbol,
		observer: RequestObserver,
	): Promise<void>;
}
export interface CourseFlashcardState {
	courseId: number;
	title: string;
	running: boolean;
	cancelled: boolean;
	stopped: boolean;
	total: number;
	processed: number;
	generated: number;
	resumed: number;
	skipped: number;
	failed: number;
	current: string;
	requests: number;
	maximumRequests: number;
	newTokens: number;
	reusedTokens: number;
	unknownUsage: number;
	errors: string[];
}
const text = (cause: unknown) =>
	cause instanceof Error ? cause.message : String(cause);

// Deliberately excludes transcript/replies and ephemeral native prepared IDs.
// Reprepare each lesson: native keeps at most eight prepared IDs, not an entire course.
export function describePrepared(input: PreparedLesson) {
	const { prepared, identity } = input;
	if (prepared.checkpointError) throw new Error(prepared.checkpointError);
	if (prepared.resume && !canResume(prepared, identity))
		throw new Error(
			"Checkpoint needs individual attention; no automatic start-over.",
		);
	const replies = prepared.resume?.replies ?? [];
	return {
		signature: JSON.stringify({
			identity,
			sourceHash: prepared.source.sourceHash,
			sourceFingerprint: prepared.source.sourceFingerprint,
			filename: prepared.source.filename,
			checkpoint: prepared.resume?.checkpoint ?? null,
		}),
		requests: remainingRequests(prepared.source, replies),
		reused: replies.length,
	};
}

export class CourseFlashcardQueue {
	private state: CourseFlashcardState | null = null;
	private run: {
		courseId: number;
		cancelled: boolean;
		task: Promise<void>;
	} | null = null;
	private listeners = new Set<() => void>();
	private get stats(): CourseFlashcardState {
		if (!this.state) throw new Error("No course flashcard queue state.");
		return this.state;
	}
	constructor(private deps: CourseQueueDependencies) {}
	getSnapshot = () => this.state;
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	private update(patch: Partial<CourseFlashcardState>) {
		if (!this.state) return;
		this.state = { ...this.state, ...patch };
		for (const listener of this.listeners) listener();
	}
	dismiss() {
		if (this.run) return;
		this.state = null;
		for (const listener of this.listeners) listener();
	}
	cancel(courseId: number | null = null) {
		if (!this.run || (courseId !== null && this.run.courseId !== courseId))
			return;
		this.run.cancelled = true;
		this.update({ cancelled: true });
		return this.run.task;
	}

	// Read-only, one source at a time; cancelling a dialog never sends a paid request.
	async prepare(
		courseId: number,
		title: string,
		signal: AbortSignal,
		progress: (done: number, total: number) => void,
	): Promise<CoursePlan> {
		const valid = this.deps.guard(courseId);
		const check = () => {
			valid();
			if (signal.aborted) throw new Error("Course preview cancelled.");
		};
		check();
		const lessons = await this.deps.lessons(courseId);
		check();
		const items: CourseItem[] = [];
		for (const lesson of lessons) {
			check();
			const item: CourseItem = {
				...lesson,
				status: "issue",
				reason: "",
				signature: "",
				requests: 0,
				reused: 0,
			};
			try {
				const saved = await this.deps.saved(lesson.id);
				check();
				if (saved) {
					item.status = "saved";
					item.reason =
						"Saved set kept (including edits and zero-card results).";
					try {
						const { prepared } = await this.deps.prepare(
							courseId,
							lesson.id,
							false,
						);
						if (
							saved.sourceHash !== prepared.source.sourceHash ||
							saved.sourceFingerprint !== prepared.source.sourceFingerprint
						)
							item.reason =
								"Saved set may be outdated; kept. Regenerate individually if wanted.";
					} catch {
						item.reason = "Saved set kept; source could not be checked.";
					}
				} else {
					const input = await this.deps.prepare(courseId, lesson.id);
					Object.assign(item, describePrepared(input), { status: "ready" });
				}
			} catch (cause) {
				item.reason = text(cause);
			}
			check();
			items.push(item);
			progress(items.length, lessons.length);
		}
		return {
			courseId,
			title,
			items,
			maximumRequests: items.reduce((n, item) => n + item.requests, 0),
			check: valid,
		};
	}

	start(plan: CoursePlan): Promise<void> {
		if (this.run)
			return Promise.reject(
				new Error("Another course flashcard queue is active."),
			);
		try {
			plan.check();
		} catch (cause) {
			return Promise.reject(cause);
		}
		let owner: symbol;
		try {
			owner = this.deps.reserve(plan.courseId);
		} catch (cause) {
			return Promise.reject(cause);
		}
		const run = {
			courseId: plan.courseId,
			cancelled: false,
			task: Promise.resolve(),
		};
		this.run = run;
		this.state = {
			courseId: plan.courseId,
			title: plan.title,
			running: true,
			cancelled: false,
			stopped: false,
			total: plan.items.length,
			processed: 0,
			generated: 0,
			resumed: 0,
			skipped: 0,
			failed: 0,
			current: "Preparing…",
			requests: 0,
			maximumRequests: plan.maximumRequests,
			newTokens: 0,
			reusedTokens: 0,
			unknownUsage: 0,
			errors: [],
		};
		this.update({});
		const check = () => {
			plan.check();
			if (run.cancelled) throw new Error("Course flashcard queue cancelled.");
		};
		const report = (issue: string) =>
			this.update({
				errors: [...(this.state?.errors ?? []), issue].slice(-50),
			});
		run.task = (async () => {
			try {
				for (const item of plan.items) {
					check();
					this.update({ current: item.title });
					try {
						if (item.status !== "ready") {
							this.update({ skipped: this.stats.skipped + 1 });
							if (item.status === "issue")
								report(`${item.title}: ${item.reason}`);
						} else if (await this.deps.saved(item.id)) {
							this.update({ skipped: this.stats.skipped + 1 });
						} else {
							check();
							const input = await this.deps.prepare(plan.courseId, item.id);
							check();
							const current = describePrepared(input);
							if (
								current.signature !== item.signature ||
								current.requests > item.requests
							)
								throw new Error(
									"Source or checkpoint changed since confirmation. Preview again; nothing sent.",
								);
							// A second check closes the preparation window before spending credits.
							if (await this.deps.saved(item.id)) {
								this.update({ skipped: this.stats.skipped + 1 });
							} else {
								let requests = 0;
								await this.deps.generate(
									input,
									!!input.prepared.resume,
									owner,
									{
										check,
										request: () => {
											check();
											if (
												requests >= item.requests ||
												this.stats.requests >= plan.maximumRequests
											)
												throw new BatchStopped(
													"Confirmed request limit reached. No extra request was sent.",
												);
											requests++;
											this.update({
												requests: this.stats.requests + 1,
												unknownUsage: this.stats.unknownUsage + 1,
											});
										},
										reply: (usage, reused) => {
											const field = reused ? "reusedTokens" : "newTokens";
											this.update({
												[field]: this.stats[field] + (usage?.totalTokens ?? 0),
												unknownUsage:
													this.stats.unknownUsage +
													(reused ? (usage ? 0 : 1) : usage ? -1 : 0),
											});
										},
										saved: () =>
											this.update({
												generated: this.stats.generated + 1,
												resumed: this.stats.resumed + (item.reused ? 1 : 0),
											}),
									},
								);
							}
						}
					} catch (cause) {
						if (run.cancelled) break;
						this.update({ failed: this.stats.failed + 1 });
						report(`${item.title}: ${text(cause)}`);
						if (cause instanceof BatchStopped) {
							this.update({
								stopped: true,
								processed: this.stats.processed + 1,
							});
							break;
						}
					}
					this.update({ processed: this.stats.processed + 1 });
				}
			} catch (cause) {
				if (!run.cancelled) {
					report(text(cause));
					this.update({ stopped: true });
				}
			} finally {
				this.deps.release(owner);
				this.run = null;
				this.update({ running: false, current: "" });
			}
		})();
		return run.task;
	}
}
