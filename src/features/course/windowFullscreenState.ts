import { invoke } from "@tauri-apps/api/core";

export async function readWindowFullscreen(window: {
	isFullscreen(): Promise<boolean>;
}) {
	const reported = await window.isFullscreen();
	// Tao on Linux caches the requested flag and misses OS-triggered state changes.
	// GTK is authoritative there; other platforms use the standard Tauri result.
	const actual = await invoke<boolean | null>("actual_window_fullscreen");
	return actual ?? reported;
}

export async function setWindowFullscreen(
	window: {
		isFullscreen(): Promise<boolean>;
		setFullscreen(value: boolean): Promise<void>;
	},
	value: boolean,
) {
	await window.setFullscreen(value);
	// GTK/compositor transitions may finish after Tauri acknowledges the request.
	for (let attempt = 0; attempt < 20; attempt++) {
		if ((await readWindowFullscreen(window)) === value) return;
		await new Promise<void>((resolve) => setTimeout(resolve, 50));
	}
	throw new Error("The window did not confirm its fullscreen state");
}
