import { isEmptyNote, limitNote } from "@/features/notes/model";

export interface NoteLesson {
	id: number;
	title: string;
	relative_path: string;
	sort_order: number;
}
export interface StoredNote {
	lesson_id: number;
	content: string;
	updated_at: string;
}
export interface Draft {
	lesson: NoteLesson;
	courseId: number;
	content: string;
	updatedAt: string | null;
	revision: number;
	savedRevision: number;
	status: "saved" | "saving" | "error";
	error: string | null;
	limitReached: boolean;
	composing: boolean;
	timer?: ReturnType<typeof setTimeout>;
	tail: Promise<void>;
	queued: Map<number, Promise<void>>;
}
interface Dependencies {
	load: (courseId: number) => Promise<StoredNote[]>;
	write: (lessonId: number, text: string) => Promise<StoredNote | null>;
	track?: (write: () => Promise<void>) => Promise<void>;
}

export function createNotesController(deps: Dependencies) {
	const drafts = new Map<number, Draft>();
	const activeLessons = new Map<number, Set<number>>();
	const courses = new Map<
		number,
		{ ready: boolean; error: string | null; pending?: Promise<void> }
	>();
	const listeners = new Set<() => void>();
	let version = 0;
	const emit = () => {
		version++;
		for (const listener of listeners) listener();
	};
	function schedule(draft: Draft) {
		clearTimeout(draft.timer);
		if (!draft.composing)
			draft.timer = setTimeout(() => {
				void flush(draft.lesson.id);
			}, 800);
	}
	function flush(lessonId: number): Promise<void> {
		const draft = drafts.get(lessonId);
		if (!draft) return Promise.resolve();
		clearTimeout(draft.timer);
		if (draft.revision === draft.savedRevision) return Promise.resolve();
		const revision = draft.revision;
		const queued = draft.queued.get(revision);
		if (queued) return queued;
		const text = limitNote(draft.content);
		const previous = draft.tail;
		draft.status = "saving";
		// Keep the failed-save warning until the newest draft really succeeds.
		const write = () =>
			previous.then(async () => {
				try {
					const stored = await deps.write(lessonId, text);
					draft.savedRevision = revision;
					draft.updatedAt = stored?.updated_at ?? null;
					if (draft.revision === revision) {
						draft.status = "saved";
						draft.error = null;
					}
				} catch {
					draft.error =
						"Couldn't save. Your draft is kept in memory; retry before closing the app.";
					if (draft.revision === revision) draft.status = "error";
				} finally {
					draft.queued.delete(revision);
					emit();
				}
			});
		const result = deps.track ? deps.track(write) : write();
		draft.queued.set(revision, result);
		draft.tail = result;
		emit();
		return result;
	}
	const controller = {
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		getSnapshot: () => version,
		get: (lessonId: number) => drafts.get(lessonId),
		course: (courseId: number) => courses.get(courseId),
		async loadCourse(courseId: number, lessons: readonly NoteLesson[]) {
			const existing = courses.get(courseId);
			if (existing?.pending) return existing.pending;
			activeLessons.set(courseId, new Set(lessons.map((lesson) => lesson.id)));
			const revisions = new Map(
				[...drafts].map(([id, draft]) => [id, draft.revision]),
			);
			const state = {
				ready: existing?.ready ?? false,
				error: null as string | null,
				pending: undefined as Promise<void> | undefined,
			};
			courses.set(courseId, state);
			state.pending = deps
				.load(courseId)
				.then((rows) => {
					const stored = new Map(rows.map((row) => [row.lesson_id, row]));
					for (const lesson of lessons) {
						const old = drafts.get(lesson.id);
						const row = stored.get(lesson.id);
						if (
							old &&
							(old.revision !== revisions.get(lesson.id) ||
								old.revision !== old.savedRevision ||
								old.queued.size ||
								old.composing)
						) {
							old.lesson = lesson;
							continue;
						}
						drafts.set(lesson.id, {
							lesson,
							courseId,
							content: row?.content ?? "",
							updatedAt: row?.updated_at ?? null,
							revision: 0,
							savedRevision: 0,
							status: "saved",
							error: null,
							limitReached: false,
							composing: false,
							tail: Promise.resolve(),
							queued: new Map(),
						});
					}
					state.ready = true;
				})
				.catch(() => {
					state.error = "Could not load notes. Please retry.";
				})
				.finally(() => {
					state.pending = undefined;
					emit();
				});
			emit();
			return state.pending;
		},
		edit(lessonId: number, content: string, limited = false) {
			const draft = drafts.get(lessonId);
			if (!draft) return;
			const next = draft.composing ? content : limitNote(content);
			draft.limitReached = limited || next.length < content.length;
			if (next !== draft.content) {
				draft.content = next;
				draft.revision++;
				draft.status = draft.error ? "error" : "saving";
				schedule(draft);
			}
			emit();
		},
		composition(lessonId: number, active: boolean) {
			const draft = drafts.get(lessonId);
			if (!draft || draft.composing === active) return;
			draft.composing = active;
			clearTimeout(draft.timer);
			if (!active) {
				controller.edit(lessonId, draft.content);
				if (draft.revision !== draft.savedRevision) schedule(draft);
			}
		},
		flush,
		async flushCourse(courseId?: number) {
			const selected = [...drafts.values()].filter(
				(draft) => courseId === undefined || draft.courseId === courseId,
			);
			await Promise.all(selected.map((draft) => flush(draft.lesson.id)));
			return selected.every(
				(draft) => draft.revision === draft.savedRevision && !draft.error,
			);
		},
		entries(courseId: number) {
			return [...drafts.values()]
				.filter(
					(draft) =>
						draft.courseId === courseId &&
						activeLessons.get(courseId)?.has(draft.lesson.id) &&
						!isEmptyNote(draft.content),
				)
				.sort(
					(a, b) =>
						a.lesson.sort_order - b.lesson.sort_order ||
						a.lesson.id - b.lesson.id,
				);
		},
		failures: () => [...drafts.values()].filter((draft) => draft.error),
	};
	return controller;
}
