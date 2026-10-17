import { setCompleted, touchLastWatched } from "@/lib/db/progress";

export async function persistCompletion(
	lessonId: number,
	previous: boolean,
	apply: (completed: boolean) => void,
): Promise<void> {
	apply(!previous);
	try {
		await setCompleted(lessonId, !previous);
	} catch (error) {
		apply(previous);
		throw error;
	}
}

export function firstPlay(lessonId: number) {
	let attempted = false;
	return (): Promise<void> => {
		if (attempted) return Promise.resolve();
		attempted = true;
		return touchLastWatched(lessonId);
	};
}

export async function playQuietly(
	video: Pick<HTMLVideoElement, "play">,
): Promise<void> {
	try {
		await video.play();
	} catch {
		/* Autoplay may be blocked: leave native controls ready. */
	}
}
