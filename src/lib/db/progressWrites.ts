const pending = new Set<Promise<void>>();
const lessons = new Map<number, Promise<void>>();
const blocked = new Set<number>();
const generations = new Map<number, number>();

export async function discardLessonWrites(
	ids: readonly number[],
): Promise<void> {
	for (const id of ids) {
		blocked.add(id);
		generations.set(id, (generations.get(id) ?? 0) + 1);
	}
	await Promise.all(ids.map((id) => lessons.get(id) ?? Promise.resolve()));
}
export function allowLessonWrites(ids: readonly number[]) {
	for (const id of ids) blocked.delete(id);
}

// Register the entire queue immediately so reads also wait for queued writes.
export function queueProgressWrite(
	lessonId: number,
	write: () => Promise<void>,
): Promise<void> {
	if (blocked.has(lessonId)) return Promise.resolve();
	const generation = generations.get(lessonId) ?? 0;
	return trackProgressWrite(() => {
		const result = (lessons.get(lessonId) ?? Promise.resolve()).then(() => {
			if (
				blocked.has(lessonId) ||
				generation !== (generations.get(lessonId) ?? 0)
			)
				return;
			return write();
		});
		const settled = result.then(
			() => {},
			() => {},
		);
		lessons.set(lessonId, settled);
		void settled.then(() => {
			if (lessons.get(lessonId) === settled) lessons.delete(lessonId);
		});
		return result;
	});
}

export function trackProgressWrite(write: () => Promise<void>): Promise<void> {
	const result = write();
	const settled = result.then(
		() => {},
		() => {},
	);
	pending.add(settled);
	void settled.then(() => pending.delete(settled));
	return result;
}

export async function waitForProgressWrites(): Promise<void> {
	while (pending.size) await Promise.all([...pending]);
}
