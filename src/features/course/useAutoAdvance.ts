import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import {
	type AutoAdvanceState,
	bindAutoAdvanceEvents,
	createAutoAdvance,
	lessonEndReady,
} from "@/features/course/autoAdvance";
import { flushPendingData } from "@/features/course/closeProgress";
import { isNativeVideoFullscreen } from "@/features/course/playerFullscreenDom";
import { hasPlayerBlockingPopup } from "@/features/course/usePlayerControls";

export function useAutoAdvance(options: {
	video: RefObject<HTMLVideoElement | null>;
	source: string | null;
	nextId: number | null;
	blocked: boolean;
	advance(): void;
	exitFullscreen(): Promise<void>;
	bindCancel(cancel: () => boolean): () => void;
	canReview(): boolean;
	openReview(current: () => boolean): Promise<void>;
}) {
	const latest = useRef(options);
	const controller = useRef<ReturnType<typeof createAutoAdvance> | null>(null);
	const [state, setState] = useState<AutoAdvanceState>(null);
	const [error, setError] = useState<string | null>(null);
	useLayoutEffect(() => {
		latest.current = options;
	});
	useLayoutEffect(() => {
		// A rescan changing the next lesson must not silently change a running target.
		void options.nextId;
		void options.blocked;
		controller.current?.cancel();
	}, [options.nextId, options.blocked]);
	const { video: videoRef, source, bindCancel } = options;
	useLayoutEffect(() => {
		const video = videoRef.current;
		if (!source || !video) return;
		const doc = video.ownerDocument;
		const page = doc.defaultView;
		if (!page) return;
		let active = true;
		const canEnd = () =>
			lessonEndReady(video, {
				blocked: latest.current.blocked,
				hidden: doc.hidden,
				popup: hasPlayerBlockingPopup(doc),
			});
		const countdown = createAutoAdvance({
			canAdvance: () => latest.current.nextId !== null && canEnd(),
			review: {
				canOpen: () => canEnd() && latest.current.canReview(),
				open: (current) => latest.current.openReview(current),
			},
			async beforeStart() {
				if (isNativeVideoFullscreen(video)) {
					await latest.current.exitFullscreen();
					if (isNativeVideoFullscreen(video))
						throw new Error("Native fullscreen did not exit");
				}
			},
			flush: flushPendingData,
			advance: () => latest.current.advance(),
			changed: (value) => {
				if (active) setState(value);
			},
			failed: () => {
				if (active)
					setError(
						"Could not open the lesson-end action. Use Review cards or Next when you are ready.",
					);
			},
		});
		controller.current = countdown;
		const unbind = bindCancel(countdown.cancel);
		const unwatch = bindAutoAdvanceEvents(video, doc, page, countdown, () =>
			setError(null),
		);
		return () => {
			active = false;
			unbind();
			unwatch();
			if (controller.current === countdown) controller.current = null;
		};
	}, [videoRef, source, bindCancel]);
	return {
		state,
		error,
		cancel: () => controller.current?.cancel(),
		advanceNow: () => {
			void controller.current?.advanceNow();
		},
	};
}
