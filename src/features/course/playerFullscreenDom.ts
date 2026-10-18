import type { FullscreenPort } from "@/features/course/playerFullscreen";

type FullscreenDocument = Document & {
	webkitFullscreenElement?: Element;
	webkitCurrentFullScreenElement?: Element;
	webkitFullscreenEnabled?: boolean;
	webkitExitFullscreen?: () => void | Promise<void>;
	webkitCancelFullScreen?: () => void | Promise<void>;
};
type FullscreenElement = HTMLElement & {
	webkitRequestFullscreen?: () => void | Promise<void>;
	webkitRequestFullScreen?: () => void | Promise<void>;
};
type FullscreenVideo = HTMLVideoElement & {
	webkitDisplayingFullscreen?: boolean;
	webkitExitFullscreen?: () => void | Promise<void>;
};

export function fullscreenPort(
	wrapper: HTMLElement,
	video: () => HTMLVideoElement | null,
	window: {
		isFullscreen(): Promise<boolean>;
		setFullscreen(value: boolean): Promise<void>;
	},
): FullscreenPort {
	const doc = wrapper.ownerDocument as FullscreenDocument;
	const element = wrapper as FullscreenElement;
	let lastNativeVideo: FullscreenVideo | null = null;
	const current = () =>
		doc.fullscreenElement ??
		doc.webkitFullscreenElement ??
		doc.webkitCurrentFullScreenElement;
	const elementMode: FullscreenPort["elementMode"] = () => {
		if (current() === wrapper) return "wrapper";
		const media = video() as FullscreenVideo | null;
		if (media && (current() === media || media.webkitDisplayingFullscreen))
			lastNativeVideo = media;
		if (
			lastNativeVideo &&
			(current() === lastNativeVideo ||
				lastNativeVideo.webkitDisplayingFullscreen)
		)
			return "native";
		lastNativeVideo = null;
		return null;
	};
	return {
		elementMode,
		isWindowFullscreen: () => window.isFullscreen(),
		setWindowFullscreen: (value) => window.setFullscreen(value),
		requestWrapper() {
			const request =
				element.requestFullscreen ??
				element.webkitRequestFullscreen ??
				element.webkitRequestFullScreen;
			if (
				!request ||
				(doc.fullscreenEnabled === false && !doc.webkitFullscreenEnabled)
			)
				return Promise.reject(new Error("Element fullscreen is unavailable"));
			return new Promise<void>((resolve, reject) => {
				const cleanup = () => {
					clearTimeout(timer);
					doc.removeEventListener("fullscreenchange", changed);
					doc.removeEventListener("webkitfullscreenchange", changed);
				};
				const failed = () => {
					cleanup();
					reject(new Error("Element fullscreen was rejected"));
				};
				const changed = () => {
					if (elementMode() === "wrapper") {
						cleanup();
						resolve();
					}
				};
				// Prefixed WebKit methods may return void; confirm their actual state via events.
				const timer = setTimeout(failed, 1200);
				doc.addEventListener("fullscreenchange", changed);
				doc.addEventListener("webkitfullscreenchange", changed);
				try {
					void Promise.resolve(request.call(element)).then(changed, failed);
				} catch {
					failed();
				}
			});
		},
		async exitElement() {
			if (current()) {
				const exit =
					doc.exitFullscreen ??
					doc.webkitExitFullscreen ??
					doc.webkitCancelFullScreen;
				if (!exit) throw new Error("Cannot exit element fullscreen");
				await exit.call(doc);
			} else {
				const media = lastNativeVideo ?? (video() as FullscreenVideo | null);
				if (media?.webkitDisplayingFullscreen)
					await media.webkitExitFullscreen?.();
			}
		},
	};
}
