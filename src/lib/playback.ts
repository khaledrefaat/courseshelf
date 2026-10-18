import { invoke } from "@tauri-apps/api/core";
import { list } from "@/lib/db/courses";

export interface RegistrationStatus {
	courseId: number;
	status: "registered" | "unauthorized" | "missing";
	message: string;
}

interface MediaSession {
	baseUrl: string;
	sessionToken: string;
}

const registrations = new Map<number, RegistrationStatus>();
let readiness: Promise<RegistrationStatus[]> | undefined;
let session: MediaSession | undefined;

export async function unregisterCourseRoot(courseId: number): Promise<void> {
	await initializePlayback();
	await invoke("unregister_course_root", { courseId });
	registrations.delete(courseId);
}

// Undefined means startup has not completed, or the course has never been registered.
export function getRegistrationStatus(
	courseId: number,
): Readonly<RegistrationStatus> | undefined {
	const value = registrations.get(courseId);
	return value ? { ...value } : undefined;
}

export function playbackErrorMessage(error: unknown): string {
	const message =
		typeof error === "object" && error !== null && "message" in error
			? String(error.message)
			: "Playback request failed";
	// Even unexpected IPC/browser errors must not expose a session URL in logs.
	return message.replace(/https?:\/\/\S+/gi, "[media URL omitted]");
}

export function initializePlayback(): Promise<RegistrationStatus[]> {
	readiness ??= (async () => {
		const [courses, mediaSession] = await Promise.all([
			list(),
			invoke<MediaSession>("get_media_session"),
		]);
		const results = await invoke<RegistrationStatus[]>(
			"register_course_roots",
			{
				roots: courses.map((course) => ({
					courseId: course.id,
					rootPath: course.root_path,
				})),
			},
		);
		session = mediaSession;
		registrations.clear();
		for (const result of results)
			registrations.set(result.courseId, { ...result });
		return results;
	})().catch(() => {
		readiness = undefined;
		session = undefined;
		throw new Error(
			"Playback startup registration failed; retry or restart the app.",
		);
	});
	return readiness;
}

export async function registerCourseRoot(
	courseId: number,
	rootPath: string,
): Promise<RegistrationStatus> {
	await initializePlayback();
	try {
		const result = await invoke<RegistrationStatus>("register_course_root", {
			courseId,
			rootPath,
		});
		registrations.set(courseId, { ...result });
		return result;
	} catch {
		const result: RegistrationStatus = {
			courseId,
			status: "unauthorized",
			message:
				"Course registration failed; re-pick the course folder and try again.",
		};
		registrations.set(courseId, result);
		return result;
	}
}

export async function getLessonUrl(
	courseId: number,
	relativePath: string,
): Promise<string> {
	await initializePlayback();
	const registration = getRegistrationStatus(courseId);
	if (!session || registration?.status !== "registered") {
		throw new Error(
			registration?.message ?? "Course has not been registered for playback.",
		);
	}
	try {
		return await invoke<string>("get_lesson_url", { courseId, relativePath });
	} catch (error) {
		throw new Error(playbackErrorMessage(error));
	}
}
