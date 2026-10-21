export type AutoAdvanceState = { seconds: number; flushing: boolean } | null;

export function lessonEndReady(
	video: {
		ended: boolean;
		seeking: boolean;
		error: unknown;
		duration: number;
		readyState: number;
	},
	page: { blocked: boolean; hidden: boolean; popup: boolean },
) {
	return (
		!page.blocked &&
		!page.hidden &&
		!page.popup &&
		video.ended &&
		!video.seeking &&
		!video.error &&
		video.readyState >= 1 &&
		Number.isFinite(video.duration) &&
		video.duration > 0
	);
}

export function createAutoAdvance(options: {
	canAdvance(): boolean;
	beforeStart(): Promise<void>;
	flush(): Promise<void>;
	advance(): void;
	changed(state: AutoAdvanceState): void;
	failed(): void;
	review?: {
		canOpen(): boolean;
		open(current: () => boolean, closed: () => Promise<void>): Promise<void>;
	};
	now?: () => number;
}) {
	const now = options.now ?? (() => performance.now());
	let phase:
		| "idle"
		| "preparing"
		| "counting"
		| "flushing"
		| "reviewing"
		| "cancelled"
		| "advanced" = "idle";
	let generation = 0;
	let disposed = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const active = () =>
		phase === "preparing" ||
		phase === "counting" ||
		phase === "flushing" ||
		phase === "reviewing";
	function cancel() {
		if (!active()) return false;
		generation++;
		clearTimeout(timer);
		phase = "cancelled";
		options.changed(null);
		return true;
	}
	function reset() {
		if (disposed) return;
		generation++;
		clearTimeout(timer);
		phase = "idle";
		options.changed(null);
	}
	function valid(ticket: number) {
		return !disposed && generation === ticket;
	}
	function fail(ticket: number) {
		if (!valid(ticket)) return;
		cancel();
		options.failed();
	}
	async function finish(ticket: number) {
		phase = "flushing";
		options.changed({ seconds: 0, flushing: true });
		try {
			await options.flush();
			if (!valid(ticket)) return;
			if (!options.canAdvance()) {
				cancel();
				return;
			}
			phase = "advanced";
			options.changed(null);
			options.advance();
		} catch {
			fail(ticket);
		}
	}
	async function advanceNow() {
		if (disposed || phase !== "counting") return;
		clearTimeout(timer);
		if (!options.canAdvance()) {
			cancel();
			return;
		}
		await finish(generation);
	}
	async function ended() {
		if (disposed || phase !== "idle") return;
		// Choose once at the real ended event, never when availability later changes.
		// No timer runs under review. Only this end's explicit dismissal may advance.
		if (options.review?.canOpen()) {
			phase = "reviewing";
			const ticket = ++generation;
			try {
				await options.review.open(
					() =>
						valid(ticket) &&
						phase === "reviewing" &&
						!!options.review?.canOpen(),
					async () => {
						if (!valid(ticket) || phase !== "reviewing") return;
						if (!options.canAdvance()) {
							cancel();
							return;
						}
						await finish(ticket);
					},
				);
			} catch {
				fail(ticket);
			}
			return;
		}
		if (!options.canAdvance()) {
			phase = "cancelled";
			return;
		}
		phase = "preparing";
		const ticket = ++generation;
		try {
			await options.beforeStart();
			if (!valid(ticket)) return;
			if (!options.canAdvance()) {
				cancel();
				return;
			}
			phase = "counting";
			const deadline = now() + 5000;
			const tick = () => {
				if (!valid(ticket) || phase !== "counting") return;
				if (!options.canAdvance()) {
					cancel();
					return;
				}
				const remaining = Math.max(0, deadline - now());
				if (!remaining) {
					void finish(ticket);
					return;
				}
				options.changed({
					seconds: Math.ceil(remaining / 1000),
					flushing: false,
				});
				timer = setTimeout(tick, Math.min(1000, remaining));
			};
			tick();
		} catch {
			fail(ticket);
		}
	}
	return {
		ended,
		advanceNow,
		cancel,
		reset,
		dispose() {
			cancel();
			disposed = true;
			generation++;
			clearTimeout(timer);
		},
	};
}

export function bindAutoAdvanceEvents(
	video: EventTarget,
	doc: EventTarget & { hidden: boolean },
	page: EventTarget,
	controller: ReturnType<typeof createAutoAdvance>,
	replayed: () => void = () => {},
) {
	const ended = () => {
		void controller.ended();
	};
	const replay = () => {
		controller.reset();
		replayed();
	};
	const cancel = () => {
		controller.cancel();
	};
	const hidden = () => {
		if (doc.hidden) cancel();
	};
	video.addEventListener("ended", ended);
	for (const event of ["play", "seeking"])
		video.addEventListener(event, replay);
	for (const event of ["error", "emptied", "loadstart"])
		video.addEventListener(event, cancel);
	doc.addEventListener("visibilitychange", hidden);
	page.addEventListener("pagehide", cancel);
	return () => {
		video.removeEventListener("ended", ended);
		for (const event of ["play", "seeking"])
			video.removeEventListener(event, replay);
		for (const event of ["error", "emptied", "loadstart"])
			video.removeEventListener(event, cancel);
		doc.removeEventListener("visibilitychange", hidden);
		page.removeEventListener("pagehide", cancel);
		controller.dispose();
	};
}
