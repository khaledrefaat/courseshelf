import {
	shouldComplete,
	shouldSave,
	startPosition,
} from "@/features/course/trackingRules";

export interface TrackingVideo extends EventTarget {
	currentTime: number;
	duration: number;
	readyState: number;
	paused: boolean;
	seeking: boolean;
	error: unknown;
}
interface TrackingOptions {
	savedPosition: number;
	completed: boolean;
	save: (seconds: number) => Promise<void>;
	complete: () => Promise<void>;
	onResume: (seconds: number | null) => void;
	onReady: () => void;
	onError: () => void;
	now?: () => number;
}

// No React or Tauri dependency: real and fake videos use the same event logic.
export function trackPlayback(video: TrackingVideo, options: TrackingOptions) {
	const now = options.now ?? (() => performance.now());
	let completed = options.completed;
	let suppressed = false;
	let completionAttempted = false;
	let phase: "loading" | "seeking" | "ready" = "loading";
	let target = 0;
	let floor = 0;
	let retries = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;
	let lastPosition = options.savedPosition;
	let lastSave = now();
	let hasSaved = options.savedPosition > 0;
	let touched = false;
	let programmaticSeek = false;
	const listeners: [string, EventListener][] = [];
	function on(name: string, handler: () => void) {
		video.addEventListener(name, handler);
		listeners.push([name, handler]);
	}
	function ready(resumed: boolean) {
		clearTimeout(timer);
		phase = "ready";
		programmaticSeek = false;
		if (resumed) options.onResume(target);
		options.onReady();
	}
	function attempt() {
		if (disposed || phase !== "seeking") return;
		if (retries >= 3) {
			// A failed WebKit seek must not erase the saved position with zero.
			floor = options.savedPosition;
			ready(false);
			return;
		}
		retries++;
		programmaticSeek = true;
		try {
			video.currentTime = target;
		} catch {
			/* Retry only a bounded number of times. */
		}
		clearTimeout(timer);
		timer = setTimeout(attempt, 750);
	}
	function initialise() {
		if (
			phase !== "loading" ||
			video.readyState < 1 ||
			!Number.isFinite(video.duration) ||
			video.duration <= 0 ||
			video.error
		)
			return;
		target = startPosition(options.savedPosition, video.duration, completed);
		if (!target) {
			ready(false);
			return;
		}
		phase = "seeking";
		attempt();
	}
	function save(immediate: boolean) {
		if (
			disposed ||
			phase !== "ready" ||
			video.error ||
			video.seeking ||
			!Number.isFinite(video.duration) ||
			video.duration <= 0
		)
			return;
		const position = Math.min(video.currentTime, video.duration);
		if (
			!Number.isFinite(position) ||
			position < 0 ||
			position < floor ||
			(!hasSaved && position < 2)
		)
			return;
		if (!touched) return; // Opening a lesson alone never counts as watching.
		if (!shouldSave(position, lastPosition, now(), lastSave, immediate)) return;
		const previous = lastPosition;
		lastPosition = position;
		lastSave = now();
		void options.save(position).then(
			() => {
				hasSaved = true;
			},
			() => {
				if (lastPosition === position) lastPosition = previous;
				if (!disposed) options.onError();
			},
		);
	}
	function complete(ended: boolean) {
		if (
			phase !== "ready" ||
			video.error ||
			suppressed ||
			completed ||
			completionAttempted ||
			!shouldComplete(
				video.currentTime,
				video.duration,
				video.paused,
				video.seeking,
				ended,
			)
		)
			return;
		completionAttempted = true;
		void options.complete().catch(() => {
			if (!disposed) options.onError();
		});
	}
	on("loadedmetadata", initialise);
	on("durationchange", initialise);
	on("canplay", () => {
		initialise();
	});
	on("seeking", () => {
		if (phase === "ready" && !programmaticSeek) {
			floor = 0;
			touched = true;
		}
	});
	on("seeked", () => {
		if (
			phase === "seeking" &&
			!video.seeking &&
			Math.abs(video.currentTime - target) < 0.5
		)
			ready(true);
		else if (phase === "ready") {
			programmaticSeek = false;
		}
	});
	on("play", () => {
		touched = true;
	});
	on("timeupdate", () => {
		if (!video.paused && !video.seeking) {
			save(false);
			complete(false);
		}
	});
	on("pause", () => save(true));
	on("ended", () => {
		touched = true;
		save(true);
		complete(true);
	});
	initialise();
	return {
		canSeek: () =>
			!disposed && phase === "ready" && video.readyState >= 1 && !video.error,
		flush: () => save(true),
		updateCompleted(value: boolean) {
			if (completed && !value) suppressed = true;
			completed = value;
		},
		startOver() {
			clearTimeout(timer);
			phase = "ready";
			floor = 0;
			touched = true;
			programmaticSeek = true;
			options.onResume(null);
			try {
				video.currentTime = 0;
			} catch {
				return;
			}
			// Persist the explicit reset immediately, including during its seek.
			lastPosition = 0;
			lastSave = now();
			hasSaved = true;
			if (!video.error && Number.isFinite(video.duration) && video.duration > 0)
				void options.save(0).catch(() => {
					if (!disposed) options.onError();
				});
		},
		dispose() {
			save(true); // Enqueued synchronously before Library's next read.
			disposed = true;
			clearTimeout(timer);
			for (const [name, handler] of listeners)
				video.removeEventListener(name, handler);
		},
	};
}
