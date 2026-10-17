import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RegistrationStatus } from "@/lib/playback";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), list: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/lib/db/courses", () => ({ list: mocks.list }));

let playback: typeof import("@/lib/playback");
const registered: RegistrationStatus = {
	courseId: 1,
	status: "registered",
	message: "Registered",
};
const unavailable: RegistrationStatus[] = [
	{
		courseId: 2,
		status: "unauthorized",
		message: "Folder not authorized; re-pick.",
	},
	{ courseId: 3, status: "missing", message: "Course folder is missing." },
];
const reports = [registered, ...unavailable];
const testUrl = "http://127.0.0.1:31415/media/fake-test-session/1/lesson.mp4";

beforeEach(async () => {
	vi.resetModules();
	mocks.invoke.mockReset();
	mocks.list.mockReset();
	mocks.list.mockResolvedValue(
		[1, 2, 3].map((id) => ({ id, root_path: `/course/${id}` })),
	);
	mocks.invoke.mockImplementation(async (command: string) => {
		switch (command) {
			case "get_media_session":
				return {
					baseUrl: "http://127.0.0.1:31415",
					sessionToken: "fake-test-session",
				};
			case "register_course_roots":
				return reports;
			case "register_course_root":
				return registered;
			case "get_lesson_url":
				return testUrl;
			default:
				throw new Error("Unexpected command");
		}
	});
	playback = await import("@/lib/playback");
});

describe("playback startup and registration state", () => {
	it("registers every DB course once and retains all statuses, including failed roots", async () => {
		expect(playback.getRegistrationStatus(1)).toBeUndefined();
		const first = playback.initializePlayback();
		expect(playback.initializePlayback()).toBe(first);
		expect(await first).toEqual(reports);
		expect(mocks.list).toHaveBeenCalledTimes(1);
		expect(mocks.invoke).toHaveBeenCalledWith("register_course_roots", {
			roots: [1, 2, 3].map((id) => ({
				courseId: id,
				rootPath: `/course/${id}`,
			})),
		});
		for (const report of reports)
			expect(playback.getRegistrationStatus(report.courseId)).toEqual(report);
		const copy = playback.getRegistrationStatus(1);
		Object.assign(copy ?? {}, { message: "Changed externally" });
		expect(playback.getRegistrationStatus(1)?.message).toBe("Registered");
	});

	it("waits for startup registration before requesting a lesson URL", async () => {
		let release!: (results: RegistrationStatus[]) => void;
		const pendingRegistration = new Promise<RegistrationStatus[]>((resolve) => {
			release = resolve;
		});
		const original = mocks.invoke.getMockImplementation();
		mocks.invoke.mockImplementation((command: string) =>
			command === "register_course_roots"
				? pendingRegistration
				: original?.(command),
		);
		const pending = playback.getLessonUrl(1, "Section/lesson.mp4");
		await vi.waitFor(() =>
			expect(mocks.invoke).toHaveBeenCalledWith(
				"register_course_roots",
				expect.anything(),
			),
		);
		expect(mocks.invoke).not.toHaveBeenCalledWith(
			"get_lesson_url",
			expect.anything(),
		);
		release(reports);
		expect(await pending).toBe(testUrl);
		expect(mocks.invoke).toHaveBeenCalledWith("get_lesson_url", {
			courseId: 1,
			relativePath: "Section/lesson.mp4",
		});
	});

	it.each(unavailable)(
		"does not request media for $status courses",
		async (report) => {
			await expect(
				playback.getLessonUrl(report.courseId, "lesson.mp4"),
			).rejects.toThrow(report.message);
			expect(mocks.invoke).not.toHaveBeenCalledWith(
				"get_lesson_url",
				expect.anything(),
			);
		},
	);

	it("registers newly added or re-picked roots after the startup snapshot and updates status", async () => {
		await playback.initializePlayback();
		mocks.invoke.mockResolvedValueOnce({
			courseId: 2,
			status: "registered",
			message: "Recovered",
		});
		await playback.registerCourseRoot(2, "/new-canonical-course");
		expect(mocks.invoke).toHaveBeenLastCalledWith("register_course_root", {
			courseId: 2,
			rootPath: "/new-canonical-course",
		});
		expect(playback.getRegistrationStatus(2)).toEqual({
			courseId: 2,
			status: "registered",
			message: "Recovered",
		});
		expect(playback.getRegistrationStatus(3)?.status).toBe("missing");
	});

	it("retains failed single-course registrations instead of silently discarding them", async () => {
		await playback.initializePlayback();
		mocks.invoke.mockRejectedValueOnce(new Error("Transport failure"));
		expect(await playback.registerCourseRoot(1, "/course/1")).toMatchObject({
			status: "unauthorized",
		});
		expect(playback.getRegistrationStatus(1)?.status).toBe("unauthorized");
	});

	it("allows startup retry after a transport failure without leaking URL details", async () => {
		mocks.list.mockRejectedValueOnce(new Error(testUrl));
		await expect(playback.initializePlayback()).rejects.toThrow(
			"Playback startup registration failed",
		);
		expect(await playback.initializePlayback()).toEqual(reports);
		expect(mocks.list).toHaveBeenCalledTimes(2);
	});

	it("redacts session URLs from unexpected playback errors", async () => {
		await playback.initializePlayback();
		mocks.invoke.mockRejectedValueOnce({
			message: `Could not open ${testUrl}`,
		});
		await expect(playback.getLessonUrl(1, "lesson.mp4")).rejects.toThrow(
			"Could not open [media URL omitted]",
		);
		expect(playback.playbackErrorMessage(new Error(testUrl))).not.toContain(
			"fake-test-session",
		);
	});
});
