import { getCurrentWindow } from "@tauri-apps/api/window";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { trackPlayback } from "@/features/course/playbackTracking";
import { playerDoubleClick } from "@/features/course/playerDoubleClick";
import {
	type FullscreenMode,
	playerFullscreen,
} from "@/features/course/playerFullscreen";
import { fullscreenPort } from "@/features/course/playerFullscreenDom";
import {
	focusPlayer,
	playerShortcuts,
} from "@/features/course/playerShortcuts";
import {
	readWindowFullscreen,
	setWindowFullscreen,
} from "@/features/course/windowFullscreenState";

// A new visit must not snapshot a previous visit's temporary window-fullscreen state.
let previousRestoration = Promise.resolve();

export function shortcutGuard(path: readonly EventTarget[], popup: boolean) {
	let blocked = popup;
	let activationTarget = false;
	for (const node of path) {
		if (!(node instanceof Element)) continue;
		if (
			node.closest(
				'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="tab"], [role="menu"], [role="listbox"]',
			)
		)
			blocked = true;
		if (node.closest('button, a, [role="button"], [role="link"]'))
			activationTarget = true;
	}
	return { blocked, activationTarget };
}

export function hasPlayerBlockingPopup(doc: Document) {
	return Array.from(
		doc.querySelectorAll(
			'[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], dialog[open]',
		),
	).some(
		(element) =>
			!element.closest(
				'[hidden], [inert], [aria-hidden="true"], [data-closed]',
			) && element.getClientRects().length > 0,
	);
}

export function usePlayerControls() {
	const autoAdvance = useRef<(() => boolean) | null>(null);
	const bindAutoAdvance = useCallback((cancel: () => boolean) => {
		autoAdvance.current = cancel;
		return () => {
			if (autoAdvance.current === cancel) autoAdvance.current = null;
		};
	}, []);
	const container = useRef<HTMLElement>(null);
	const binding = useRef<{
		video: HTMLVideoElement;
		tracking: ReturnType<typeof trackPlayback>;
	} | null>(null);
	const fullscreen = useRef<ReturnType<typeof playerFullscreen> | null>(null);
	const [mode, setMode] = useState<FullscreenMode>("none");
	const expanded = mode === "wrapper" || mode === "window";
	const savedScroll = useRef<{
		element: HTMLElement;
		top: number;
		left: number;
	} | null>(null);
	useLayoutEffect(() => {
		if (!expanded && savedScroll.current) {
			const { element, top, left } = savedScroll.current;
			element.scrollTop = top;
			element.scrollLeft = left;
			savedScroll.current = null;
		}
	}, [expanded]);
	const [indicator, setIndicator] = useState({ text: "", visible: false });
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const focus = useCallback(() => focusPlayer(container.current), []);
	const exit = useCallback(
		() => fullscreen.current?.exit() ?? Promise.resolve(),
		[],
	);
	const bindPlayer = useCallback(
		(video: HTMLVideoElement, tracking: ReturnType<typeof trackPlayback>) => {
			const value = { video, tracking };
			binding.current = value;
			const changed = () => fullscreen.current?.syncElement();
			video.addEventListener("webkitbeginfullscreen", changed);
			video.addEventListener("webkitendfullscreen", changed);
			return () => {
				video.removeEventListener("webkitbeginfullscreen", changed);
				video.removeEventListener("webkitendfullscreen", changed);
				if (binding.current === value) binding.current = null;
			};
		},
		[],
	);
	useEffect(() => {
		const wrapper = container.current;
		if (!wrapper) return;
		let active = true;
		const indicate = (text: string) => {
			if (!active) return;
			clearTimeout(timer.current);
			setIndicator({ text, visible: true });
			timer.current = setTimeout(
				() => setIndicator({ text, visible: false }),
				900,
			);
		};
		const nativeWindow = getCurrentWindow();
		const prior = previousRestoration;
		const controller = playerFullscreen(
			fullscreenPort(wrapper, () => binding.current?.video ?? null, {
				async isFullscreen() {
					await prior;
					return readWindowFullscreen(nativeWindow);
				},
				async setFullscreen(value) {
					await prior;
					await setWindowFullscreen(nativeWindow, value);
				},
			}),
			(next) => {
				if (
					(next === "wrapper" || next === "window") &&
					!savedScroll.current &&
					wrapper.parentElement
				) {
					const element = wrapper.parentElement;
					savedScroll.current = {
						element,
						top: element.scrollTop,
						left: element.scrollLeft,
					};
				}
				setMode(next);
			},
			() => indicate("Could not change fullscreen. Press f to retry."),
		);
		fullscreen.current = controller;
		const shortcuts = playerShortcuts({
			cancelAutoAdvance: () => autoAdvance.current?.() ?? false,
			video: () => binding.current?.video ?? null,
			canSeek: () => binding.current?.tracking.canSeek() ?? false,
			focus,
			toggleFullscreen: () => {
				void controller.toggle();
			},
			exitFullscreen: () => {
				void controller.exit();
			},
			isFullscreen: controller.isActive,
			indicate,
		});
		const keydown = (event: KeyboardEvent) =>
			shortcuts.keydown(
				event,
				shortcutGuard(event.composedPath(), hasPlayerBlockingPopup(document)),
			);
		const keyup = (event: KeyboardEvent) =>
			shortcuts.spaceContinuation(event, true);
		const keypress = (event: KeyboardEvent) =>
			shortcuts.spaceContinuation(event, false);
		const click = (event: MouseEvent) =>
			shortcuts.click(
				event,
				event.target === binding.current?.video || event.target === wrapper,
			);
		const changed = () => controller.syncElement();
		const doubleClick = (event: MouseEvent) =>
			playerDoubleClick(
				event,
				binding.current?.video ?? null,
				hasPlayerBlockingPopup(document),
				() => {
					void controller.toggle();
				},
			);
		const windowChanged = () => {
			void controller.syncWindow();
		};
		const blur = () => shortcuts.reset();
		const leaving = () => {
			void controller.exit();
		};
		document.addEventListener("keydown", keydown, true);
		document.addEventListener("keyup", keyup, true);
		document.addEventListener("keypress", keypress, true);
		document.addEventListener("click", click, true);
		wrapper.addEventListener("dblclick", doubleClick, true);
		document.addEventListener("fullscreenchange", changed);
		document.addEventListener("webkitfullscreenchange", changed);
		window.addEventListener("resize", windowChanged);
		window.addEventListener("focus", windowChanged);
		window.addEventListener("blur", blur);
		document.addEventListener("pointerdown", blur, true);
		window.addEventListener("pagehide", leaving);
		// Window fullscreen has no DOM fullscreenchange event. Also detect OS exits that
		// leave a maximized window at the same client size (and hence emit no resize).
		const poll = setInterval(() => {
			if (controller.usesWindow()) windowChanged();
		}, 500);
		return () => {
			active = false;
			clearTimeout(timer.current);
			clearInterval(poll);
			document.removeEventListener("keydown", keydown, true);
			document.removeEventListener("keyup", keyup, true);
			document.removeEventListener("keypress", keypress, true);
			document.removeEventListener("click", click, true);
			wrapper.removeEventListener("dblclick", doubleClick, true);
			document.removeEventListener("fullscreenchange", changed);
			document.removeEventListener("webkitfullscreenchange", changed);
			window.removeEventListener("resize", windowChanged);
			window.removeEventListener("focus", windowChanged);
			window.removeEventListener("blur", blur);
			document.removeEventListener("pointerdown", blur, true);
			window.removeEventListener("pagehide", leaving);
			if (fullscreen.current === controller) fullscreen.current = null;
			previousRestoration = Promise.all([prior, controller.dispose()]).then(
				() => {},
				() => {},
			);
		};
	}, [focus]);
	return {
		container,
		bindPlayer,
		bindAutoAdvance,
		focus,
		exit,
		mode,
		indicator,
		expanded,
	};
}
