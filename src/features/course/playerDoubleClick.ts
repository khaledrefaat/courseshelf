interface VideoSurface extends EventTarget {
	controls: boolean;
	getBoundingClientRect(): Pick<DOMRect, "top" | "bottom" | "left" | "right">;
}

export function playerDoubleClick(
	event: Pick<
		MouseEvent,
		| "target"
		| "button"
		| "defaultPrevented"
		| "ctrlKey"
		| "altKey"
		| "metaKey"
		| "clientX"
		| "clientY"
		| "preventDefault"
		| "stopImmediatePropagation"
	>,
	video: VideoSurface | null,
	blocked: boolean,
	toggle: () => void,
) {
	if (
		!video ||
		blocked ||
		event.target !== video ||
		event.button !== 0 ||
		event.defaultPrevented ||
		event.ctrlKey ||
		event.altKey ||
		event.metaKey
	)
		return;
	const bounds = video.getBoundingClientRect();
	// UA controls are retargeted to the video in some webviews. Leave their bottom
	// strip alone rather than hijacking seek/volume/fullscreen control gestures.
	const pictureBottom = bounds.bottom - (video.controls ? 64 : 0);
	if (
		event.clientX < bounds.left ||
		event.clientX > bounds.right ||
		event.clientY < bounds.top ||
		event.clientY >= pictureBottom
	)
		return;
	event.preventDefault();
	event.stopImmediatePropagation();
	toggle(); // Synchronous user gesture: same wrapper-first controller as f.
}
