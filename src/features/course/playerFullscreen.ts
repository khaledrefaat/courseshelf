export type FullscreenMode = "none" | "wrapper" | "native" | "window";

export interface FullscreenPort {
	elementMode(): "wrapper" | "native" | null;
	requestWrapper(): Promise<void>;
	exitElement(): Promise<void>;
	isWindowFullscreen(): Promise<boolean>;
	setWindowFullscreen(value: boolean): Promise<void>;
}

// Browser/window IO is injected. In particular, nothing here changes playback or geometry.
export function playerFullscreen(
	port: FullscreenPort,
	onMode: (mode: FullscreenMode) => void,
	onError: () => void,
) {
	let mode: FullscreenMode = "none";
	let originalWindow: boolean | null = null;
	let entering: Promise<void> | null = null;
	let checking: Promise<void> | null = null;
	let exiting: Promise<void> | null = null;
	let cancelled = false;
	let disposed = false;
	let generation = 0;
	function publish(next: FullscreenMode) {
		mode = next;
		if (!disposed) onMode(next);
	}
	function syncElement() {
		const element = port.elementMode();
		publish(element ?? (originalWindow !== null ? "window" : "none"));
	}
	async function leave() {
		try {
			if (port.elementMode()) await port.exitElement();
		} catch {
			if (!disposed) onError();
		}
		if (originalWindow !== null) {
			try {
				await port.setWindowFullscreen(originalWindow);
				originalWindow = null;
			} catch {
				// Retain ownership so a subsequent exit/dispose can retry restoration.
				if (!disposed) onError();
			}
		}
		syncElement();
	}
	function exit(): Promise<void> {
		cancelled = true;
		generation++;
		if (exiting) return exiting;
		exiting = (async () => {
			await entering;
			await leave();
		})().finally(() => {
			exiting = null;
		});
		return exiting;
	}
	async function enter() {
		try {
			// Called synchronously from the key gesture, before any window IPC/await.
			await port.requestWrapper();
			if (port.elementMode() !== "wrapper")
				throw new Error("No fullscreen element");
			if (!cancelled && !disposed) syncElement();
			return;
		} catch {
			if (cancelled || disposed) return;
		}
		try {
			const original = await port.isWindowFullscreen();
			if (cancelled || disposed) return;
			originalWindow = original;
			await port.setWindowFullscreen(true);
			if (!cancelled && !disposed) syncElement();
		} catch {
			await leave();
			if (!disposed) onError();
		}
	}
	function beginEntry() {
		cancelled = false;
		generation++;
		entering = enter().finally(() => {
			entering = null;
		});
		return entering;
	}
	return {
		isActive: () =>
			mode !== "none" ||
			entering !== null ||
			checking !== null ||
			originalWindow !== null,
		usesWindow: () => originalWindow !== null,
		syncElement,
		exit,
		toggle(): Promise<void> {
			if (disposed) return Promise.resolve();
			if (exiting) return exiting;
			if (entering) return exit();
			if (checking) return checking;
			syncElement();
			if (originalWindow !== null && !port.elementMode()) {
				// f immediately after an OS exit must enter again, even before the poll.
				const started = generation;
				checking = (async () => {
					const active = await port.isWindowFullscreen();
					if (disposed || started !== generation) return;
					if (active) return exit();
					originalWindow = null;
					syncElement();
					return beginEntry();
				})()
					.catch(() => {
						if (!disposed) onError();
					})
					.finally(() => {
						checking = null;
					});
				return checking;
			}
			if (mode !== "none") return exit();
			return beginEntry();
		},
		async syncWindow() {
			if (originalWindow === null || entering || exiting || disposed) return;
			const started = generation;
			try {
				const active = await port.isWindowFullscreen();
				if (
					!active &&
					started === generation &&
					originalWindow !== null &&
					!entering &&
					!exiting &&
					!disposed
				) {
					// The OS already exited. Respect that action; do not re-enter fullscreen.
					originalWindow = null;
					syncElement();
				}
			} catch {
				if (!disposed) onError();
			}
		},
		dispose() {
			disposed = true;
			return exit().then(() => (originalWindow !== null ? leave() : undefined));
		},
	};
}
