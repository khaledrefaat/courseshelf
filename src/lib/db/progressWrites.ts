const pending = new Set<Promise<void>>();

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
