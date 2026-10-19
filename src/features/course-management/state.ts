import { useSyncExternalStore } from "react";

let busy = false;
let revision = 0;
let notice = "";
let locateId: number | undefined;
let selection: {
	courseId: number;
	action: "edit" | "remove" | "locate" | "subtitles";
} | null = null;
let version = 0;
const playbackVersions = new Map<number, number>();
const listeners = new Set<() => void>();
const players = new Map<number, () => void>();
const emit = () => {
	version++;
	for (const listener of listeners) listener();
};
export function useManagement() {
	useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		() => version,
		() => version,
	);
	return { busy, revision, notice, selection, locateId, playbackVersions };
}
export function openCourseAction(
	courseId: number,
	action: "edit" | "remove" | "locate" | "subtitles",
) {
	if (!busy) {
		selection = { courseId, action };
		emit();
	}
}
export function closeCourseAction() {
	selection = null;
	emit();
}
export function refreshManagement(
	message: string,
	locate?: number,
	playbackCourse?: number,
) {
	if (playbackCourse !== undefined)
		playbackVersions.set(
			playbackCourse,
			(playbackVersions.get(playbackCourse) ?? 0) + 1,
		);
	revision++;
	notice = message;
	locateId = locate;
	emit();
}
export async function manage<T>(task: () => Promise<T>): Promise<T> {
	if (busy)
		throw new Error("Another course operation is running. Please wait.");
	busy = true;
	emit();
	try {
		return await task();
	} finally {
		busy = false;
		emit();
	}
}
export function registerManagedPlayer(courseId: number, pause: () => void) {
	players.set(courseId, pause);
	return () => {
		if (players.get(courseId) === pause) players.delete(courseId);
	};
}
export function pauseCourse(courseId: number) {
	players.get(courseId)?.();
}
