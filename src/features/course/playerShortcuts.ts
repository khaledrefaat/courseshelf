export interface ShortcutVideo {
	currentTime: number;
	duration: number;
	volume: number;
	muted: boolean;
	paused: boolean;
	play(): Promise<void> | void;
	pause(): void;
}
export interface ShortcutKey {
	key: string;
	code: string;
	repeat: boolean;
	isComposing: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	metaKey: boolean;
	defaultPrevented: boolean;
	preventDefault(): void;
	stopImmediatePropagation(): void;
}
export interface ShortcutGuard {
	blocked: boolean;
	activationTarget: boolean;
}
export interface ShortcutWheel {
	deltaY: number;
	defaultPrevented: boolean;
	preventDefault(): void;
	stopImmediatePropagation(): void;
}
export const isSpace = (event: Pick<ShortcutKey, "key" | "code">) =>
	event.code === "Space" || event.key === " " || event.key === "Spacebar";

function consume(
	event: Pick<ShortcutKey, "preventDefault" | "stopImmediatePropagation">,
) {
	event.preventDefault();
	event.stopImmediatePropagation();
}

export function focusPlayer(
	container: { focus(options: FocusOptions): void } | null,
) {
	container?.focus({ preventScroll: true });
}

export function playerShortcuts(options: {
	video(): ShortcutVideo | null;
	canSeek(): boolean;
	focus(): void;
	toggleFullscreen(): void;
	exitFullscreen(): void;
	isFullscreen(): boolean;
	indicate(text: string): void;
	cancelAutoAdvance?(): boolean;
}) {
	let spaceHeld = false;
	let spaceClickPending = false;
	function adjustVolume(video: ShortcutVideo, raising: boolean) {
		// Use the displayed whole percentage: native volume readback can drift
		// slightly around a step boundary after setting the media volume.
		const percent = Math.round(video.volume * 100);
		const next = raising
			? (Math.floor(percent / 5) + 1) * 5
			: (Math.ceil(percent / 5) - 1) * 5;
		video.volume = Math.max(0, Math.min(100, next)) / 100;
		if (raising) video.muted = false;
		options.indicate(`Volume ${Math.round(video.volume * 100)}%`);
	}
	return {
		keydown(event: ShortcutKey, guard: ShortcutGuard) {
			if (!isSpace(event)) spaceClickPending = false;
			if (
				event.defaultPrevented ||
				event.isComposing ||
				event.ctrlKey ||
				event.altKey ||
				event.metaKey ||
				guard.blocked
			)
				return;
			const space = isSpace(event);
			if (space && guard.activationTarget) return;
			const key = event.key.toLowerCase();
			if (key === "s" && options.cancelAutoAdvance?.()) {
				consume(event);
				return;
			}
			if (key === "f" || (key === "escape" && options.isFullscreen())) {
				consume(event);
				if (!event.repeat) {
					if (key === "f") options.toggleFullscreen();
					else options.exitFullscreen();
				}
				return;
			}
			const video = options.video();
			if (!video) return;
			if (space) {
				consume(event);
				if (event.repeat || spaceHeld) return;
				spaceHeld = true;
				spaceClickPending = true;
				// Move focus off native controls before their keyup/click activation path.
				options.focus();
				if (video.paused) {
					try {
						void Promise.resolve(video.play()).catch(() => {});
					} catch {
						/* Media may not be ready. */
					}
					options.indicate("Play");
				} else {
					video.pause();
					options.indicate("Pause");
				}
			} else if (key === "arrowleft" || key === "arrowright") {
				// Also suppress native seeking/scrolling while resume initialization is pending.
				consume(event);
				if (
					!options.canSeek() ||
					!Number.isFinite(video.currentTime) ||
					!Number.isFinite(video.duration) ||
					video.duration <= 0
				)
					return;
				const delta = key === "arrowleft" ? -10 : 10;
				video.currentTime = Math.max(
					0,
					Math.min(video.duration, video.currentTime + delta),
				);
				options.indicate(delta > 0 ? "+10s" : "−10s");
			} else if (key === "arrowup" || key === "arrowdown") {
				consume(event);
				adjustVolume(video, key === "arrowup");
			} else if (key === "m") {
				consume(event);
				if (event.repeat) return;
				video.muted = !video.muted;
				options.indicate(video.muted ? "Muted" : "Unmuted");
			}
		},
		wheel(event: ShortcutWheel) {
			if (!options.isFullscreen()) return;
			if (event.defaultPrevented || !Number.isFinite(event.deltaY)) return;
			if (event.deltaY === 0) return;
			const video = options.video();
			if (!video) return;
			consume(event);
			adjustVolume(video, event.deltaY < 0);
		},
		spaceContinuation(event: ShortcutKey, released: boolean) {
			if (!spaceHeld || !isSpace(event)) return;
			consume(event);
			spaceClickPending = true;
			if (released) spaceHeld = false;
		},
		click(
			event: {
				detail: number;
				preventDefault(): void;
				stopImmediatePropagation(): void;
			},
			nativeTarget: boolean,
		) {
			if (
				nativeTarget &&
				event.detail === 0 &&
				(spaceHeld || spaceClickPending)
			) {
				consume(event);
				spaceClickPending = false;
			} else if (event.detail > 0 || !nativeTarget) {
				spaceClickPending = false;
			}
		},
		reset() {
			spaceHeld = false;
			spaceClickPending = false;
		},
	};
}
