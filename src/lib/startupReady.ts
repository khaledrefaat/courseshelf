// A hidden WebView2 may suspend RAF. The timer is a fallback, not a mandatory
// delay. Rust also has an independent five-second fallback if JS/IPC fails.
export function scheduleStartupReady(
	notify: () => Promise<void>,
	frames: Pick<Window, "requestAnimationFrame" | "cancelAnimationFrame">,
): () => void {
	let active = true;
	let frame: number | undefined;
	const finish = () => {
		if (!active) return;
		active = false;
		clearTimeout(timer);
		if (frame !== undefined) frames.cancelAnimationFrame(frame);
		void Promise.resolve()
			.then(notify)
			.catch(() => {
				// The native timeout still reveals the window, including on IPC failure.
			});
	};
	const timer = setTimeout(finish, 200);
	frame = frames.requestAnimationFrame(() => {
		if (active) frame = frames.requestAnimationFrame(finish);
	});
	return () => {
		active = false;
		clearTimeout(timer);
		if (frame !== undefined) frames.cancelAnimationFrame(frame);
	};
}
