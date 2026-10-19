export interface QueueLesson {
	id: number;
	title: string;
	relative_path: string;
}
export interface CourseQueueState {
	courseId: number;
	title: string;
	running: boolean;
	cancelled: boolean;
	total: number;
	processed: number;
	generated: number;
	reused: number;
	skipped: number;
	failed: number;
	exported: number;
	exportFailed: number;
	current: string;
	errors: string[];
}
export interface QueueDependencies {
	reserve(): symbol;
	release(owner: symbol): void;
	lessons(courseId: number): Promise<QueueLesson[]>;
	sidecar(courseId: number, lesson: QueueLesson): Promise<boolean>;
	cached(courseId: number, lesson: QueueLesson): Promise<boolean>;
	generate(
		courseId: number,
		lesson: QueueLesson,
		consent: boolean,
		owner: symbol,
	): Promise<void>;
	export(courseId: number, lesson: QueueLesson): Promise<"saved" | "existing">;
}
const errorText = (cause: unknown) =>
	cause instanceof Error ? cause.message : String(cause);

// Lives above lesson components: navigation never owns or restarts the queue.
export class CourseSubtitleQueue {
	private state: CourseQueueState | null = null;
	private run:
		| { courseId: number; cancelled: boolean; promise: Promise<void> }
		| undefined;
	private listeners = new Set<() => void>();
	constructor(private dependencies: QueueDependencies) {}
	getSnapshot = () => this.state;
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	private update(change: Partial<CourseQueueState>) {
		if (!this.state) return;
		this.state = { ...this.state, ...change };
		for (const listener of this.listeners) listener();
	}
	dismiss() {
		if (!this.run) {
			this.state = null;
			for (const listener of this.listeners) listener();
		}
	}
	// Mark synchronously, then drain in-flight export/checks before relocation/removal.
	cancel = (courseId?: number): Promise<void> | undefined => {
		if (!this.run || (courseId !== undefined && courseId !== this.run.courseId))
			return;
		this.run.cancelled = true;
		this.update({ cancelled: true });
		return this.run.promise;
	};
	async start(
		courseId: number,
		title: string,
		saveBeside: boolean,
		consent: boolean,
	) {
		if (this.run) throw new Error("Another course subtitle queue is running.");
		const owner = this.dependencies.reserve();
		this.state = {
			courseId,
			title,
			running: true,
			cancelled: false,
			total: 0,
			processed: 0,
			generated: 0,
			reused: 0,
			skipped: 0,
			failed: 0,
			exported: 0,
			exportFailed: 0,
			current: "Loading lessons…",
			errors: [],
		};
		const run = { courseId, cancelled: false, promise: Promise.resolve() };
		this.run = run;
		this.update({});
		run.promise = (async () => {
			const report = (text: string) =>
				this.update({
					errors: [...(this.state?.errors ?? []), text].slice(-50),
				});
			try {
				const lessons = await this.dependencies.lessons(courseId);
				this.update({ total: lessons.length });
				for (const lesson of lessons) {
					if (run.cancelled) break;
					this.update({ current: lesson.title });
					try {
						const existing = await this.dependencies.sidecar(courseId, lesson);
						if (run.cancelled) break;
						if (existing)
							this.update({ skipped: (this.state?.skipped ?? 0) + 1 });
						else {
							const cached = await this.dependencies.cached(courseId, lesson);
							if (run.cancelled) break;
							if (cached)
								this.update({ reused: (this.state?.reused ?? 0) + 1 });
							else {
								await this.dependencies.generate(
									courseId,
									lesson,
									consent,
									owner,
								);
								if (run.cancelled) break;
								this.update({ generated: (this.state?.generated ?? 0) + 1 });
							}
							if (saveBeside && !run.cancelled) {
								try {
									const result = await this.dependencies.export(
										courseId,
										lesson,
									);
									if (result === "saved")
										this.update({ exported: (this.state?.exported ?? 0) + 1 });
								} catch (cause) {
									this.update({
										exportFailed: (this.state?.exportFailed ?? 0) + 1,
									});
									report(
										`${lesson.title}: subtitles kept in Courseshelf, but export failed: ${errorText(cause)}`,
									);
								}
							}
						}
					} catch (cause) {
						if (run.cancelled) break;
						this.update({ failed: (this.state?.failed ?? 0) + 1 });
						report(`${lesson.title}: ${errorText(cause)}`);
					}
					this.update({ processed: (this.state?.processed ?? 0) + 1 });
				}
			} catch (cause) {
				report(errorText(cause));
			} finally {
				this.dependencies.release(owner);
				this.run = undefined;
				this.update({ running: false, current: "" });
			}
		})();
		await run.promise;
	}
}
