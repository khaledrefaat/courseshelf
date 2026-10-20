export type FlipPhase = "idle" | "closing" | "opening";
export const FLIP_HALF_MS = 140;

// A single face folds to a positive, narrow scale, swaps text, then unfolds.
// No backfaces, negative scales or 180-degree text surfaces can be painted.
export function createFlashcardFlip(options: {
	reducedMotion(): boolean;
	changed(phase: FlipPhase): void;
	flip(): void;
}) {
	let busy = false;
	let disposed = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	return {
		request() {
			if (busy || disposed) return;
			if (options.reducedMotion()) {
				options.flip();
				return;
			}
			busy = true;
			options.changed("closing");
			if (disposed) return;
			timer = setTimeout(() => {
				if (disposed) return;
				options.flip();
				if (disposed) return;
				options.changed("opening");
				timer = setTimeout(() => {
					if (disposed) return;
					busy = false;
					options.changed("idle");
				}, FLIP_HALF_MS);
			}, FLIP_HALF_MS);
		},
		dispose() {
			disposed = true;
			clearTimeout(timer);
		},
	};
}
