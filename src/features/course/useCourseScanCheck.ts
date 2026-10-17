import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import {
	lastCourseKey,
	readLastCourse,
} from "@/features/course/lastTestCourse";
import * as courses from "@/lib/db/courses";
import { syncCourse } from "@/lib/db/syncCourse";
import { registerCourseRoot } from "@/lib/playback";

export function useCourseScanCheck() {
	const [courseId, setCourseId] = useState(readLastCourse);
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState("");

	async function run(courseId: number) {
		const result = await syncCourse(courseId);
		if (!result.ok) {
			console.error("[course scan] FAIL", result);
			setStatus(`${result.code}: ${result.message}`);
			return;
		}
		const registration = await registerCourseRoot(
			courseId,
			result.scan.root_path,
		);
		if (registration.status !== "registered") {
			setStatus(registration.message);
			return;
		}
		console.log("[course scan]", {
			course_id: result.course_id,
			root_path: result.scan.root_path,
			sections: result.scan.sections,
			lesson_count: result.scan.lessons.length,
			ignored_count: result.scan.ignored_count,
			skipped_symlink_count: result.scan.skipped_symlink_count,
			added_count: result.added_count,
			missing_count: result.missing_count,
			summary: result.summary,
		});
		setStatus(
			`Course #${courseId}: ${result.scan.lessons.length} videos, ${result.scan.ignored_count} ignored files, ${result.scan.skipped_symlink_count} skipped symlinks. See console.`,
		);
	}

	async function pickAndSync() {
		setBusy(true);
		try {
			const picked = await open({
				directory: true,
				recursive: true,
				multiple: false,
			});
			if (!picked) return;
			const root = await invoke<string>("canonicalize_course_root", {
				root: picked,
			});
			const course =
				(await courses.getByRootPath(root)) ??
				(await courses.create({
					title: root.split("/").filter(Boolean).pop() ?? root,
					root_path: root,
				}));
			setCourseId(course.id);
			localStorage.setItem(lastCourseKey, String(course.id));
			await run(course.id);
		} catch (error) {
			console.error("[course scan] FAIL", error);
			setStatus(
				typeof error === "object" && error !== null
					? JSON.stringify(error)
					: String(error),
			);
		} finally {
			setBusy(false);
		}
	}

	async function syncAgain() {
		if (courseId === null) return;
		setBusy(true);
		try {
			await run(courseId);
		} catch (error) {
			console.error("[course scan] FAIL", error);
			setStatus(String(error));
		} finally {
			setBusy(false);
		}
	}

	return { pickAndSync, syncAgain, busy, courseId, status };
}
