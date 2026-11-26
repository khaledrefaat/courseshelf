import { playQuietly } from "@/features/course/progressActions";

interface VideoSurface extends EventTarget {
	controls: boolean;
	getBoundingClientRect(): Pick<DOMRect, "top" | "bottom" | "left" | "right">;
}

type PictureClick = Pick<
	MouseEvent,
	| "detail"
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
>;

function onPicture(
	event: PictureClick,
	video: VideoSurface | null,
	blocked: boolean,
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
		return false;
	const bounds = video.getBoundingClientRect();
	// UA controls are retargeted to the video in some webviews. Leave their bottom
	// strip alone rather than hijacking seek/volume/fullscreen control gestures.
	const pictureBottom = bounds.bottom - (video.controls ? 64 : 0);
	return (
		event.clientX >= bounds.left &&
		event.clientX <= bounds.right &&
		event.clientY >= bounds.top &&
		event.clientY < pictureBottom
	);
}

function consume(event: PictureClick) {
	event.preventDefault();
	event.stopImmediatePropagation();
}

export function playerDoubleClick(
	event: PictureClick,
	video: VideoSurface | null,
	blocked: boolean,
	toggle: () => void,
) {
	if (!onPicture(event, video, blocked)) return;
	consume(event);
	toggle(); // Keep any element fullscreen request within the user gesture.
}

type PlaybackSurface = VideoSurface &
	Pick<HTMLVideoElement, "paused" | "ended" | "error" | "play" | "pause">;

export const WINDOWS_PICTURE_CLICK_DELAY = 500;

export function windowsPictureClicks(options: {
	video: () => PlaybackSurface | null;
	blocked: () => boolean;
	toggleFullscreen: () => void;
}) {
	let pending: {
		video: PlaybackSurface;
		paused: boolean;
		ended: boolean;
		timer: ReturnType<typeof setTimeout>;
	} | null = null;
	function cancel() {
		if (!pending) return;
		clearTimeout(pending.timer);
		pending = null;
	}
	function finishSingleClick() {
		if (!pending) return;
		const { video, paused, ended } = pending;
		cancel();
		if (
			video !== options.video() ||
			video.paused !== paused ||
			video.ended !== ended ||
			video.error ||
			options.blocked()
		)
			return;
		if (paused) void playQuietly(video);
		else video.pause();
	}
	return {
		cancel,
		click(event: PictureClick & Pick<MouseEvent, "shiftKey">) {
			const video = options.video();
			if (
				(event.detail !== 1 && event.detail !== 2) ||
				event.shiftKey ||
				!video ||
				!onPicture(event, video, options.blocked())
			) {
				cancel();
				return;
			}
			// The native first click may pause playback. Capture both clicks so
			// only a confirmed single click can change the playback state.
			consume(event);
			if (event.detail === 2) {
				const matches = pending?.video === video;
				cancel();
				if (matches) options.toggleFullscreen();
				return;
			}
			finishSingleClick();
			pending = {
				video,
				paused: video.paused,
				ended: video.ended,
				timer: setTimeout(finishSingleClick, WINDOWS_PICTURE_CLICK_DELAY),
			};
		},
	};
}
