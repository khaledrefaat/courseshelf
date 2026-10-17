const pending = new Set<Promise<void>>();
const lessons = new Map<number, Promise<void>>();

// Register the entire queue immediately so reads also wait for queued writes.
export function queueProgressWrite(
	lessonId: number,
	write: () => Promise<void>,
): Promise<void> {
	return trackProgressWrite(() => {
		const result = (lessons.get(lessonId) ?? Promise.resolve()).then(write);
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
