export type AutoAdvanceState = { seconds: number; flushing: boolean } | null;

export function createAutoAdvance(options: {
	canAdvance(): boolean;
	beforeStart(): Promise<void>;
	flush(): Promise<void>;
	advance(): void;
	changed(state: AutoAdvanceState): void;
	failed(): void;
	now?: () => number;
}) {
	const now = options.now ?? (() => performance.now());
	let phase:
		| "idle"
		| "preparing"
		| "counting"
		| "flushing"
		| "cancelled"
		| "advanced" = "idle";
	let generation = 0;
	let disposed = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const active = () =>
		phase === "preparing" || phase === "counting" || phase === "flushing";
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
	async function ended() {
		if (disposed || phase !== "idle" || !options.canAdvance()) return;
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
				if (!valid(ticket)) return;
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
