import { getCurrentWindow } from "@tauri-apps/api/window";
import { waitForProgressWrites } from "@/lib/db/progressWrites";

const flushers = new Set<() => void>();
export async function flushPendingData() {
	for (const flush of flushers) {
		try {
			flush();
		} catch {
			/* Best effort. */
		}
	}
	await waitForProgressWrites();
}
export function registerProgressFlush(flush: () => void) {
	flushers.add(flush);
	return () => {
		flushers.delete(flush);
	};
}

// Never keep the user in the app because SQLite is slow or unavailable.
export async function boundedFlush(
	flush: () => Promise<void>,
	timeout = 2000,
): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			Promise.resolve().then(flush),
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, timeout);
			}),
		]);
	} catch {
		/* Closing always proceeds, even after a failed save. */
	} finally {
		clearTimeout(timer);
	}
}

export async function installCloseFlush() {
	// onCloseRequested awaits this handler and then destroys the window itself.
	return getCurrentWindow().onCloseRequested(() =>
		boundedFlush(async () => {
			for (const flush of flushers) {
				try {
					flush();
				} catch {
					/* One failed flusher must not block the rest. */
				}
			}
			await waitForProgressWrites();
		}),
	);
}
