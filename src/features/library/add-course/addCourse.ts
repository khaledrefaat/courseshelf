import {
	type PickedCover,
	saveCover,
} from "@/features/library/add-course/covers";
import {
	errorMessage,
	findDuplicate,
} from "@/features/library/add-course/folders";
import * as courses from "@/lib/db/courses";
import { syncCourse } from "@/lib/db/syncCourse";
import { registerCourseRoot } from "@/lib/playback";
import { scanCourse } from "@/lib/scanner/scanCourse";

let adding = false;
export async function addCourse(input: {
	root: string;
	title: string;
	cover: PickedCover | null;
}): Promise<{ courseId: number; warning: string | null }> {
	if (adding) throw new Error("A course is already being added.");
	adding = true;
	let createdId: number | undefined;
	try {
		const title = input.title.trim();
		if (!title || title.length > 120)
			throw new Error("Enter a course title of 1–120 characters.");
		const scan = await scanCourse(input.root);
		if (!scan.lessons.length)
			throw new Error("No supported videos found. The course was not added.");
		if (await findDuplicate(scan.root_path))
			throw new Error("This folder is already in your library");
		createdId = await courses.insert({ title, root_path: scan.root_path });
		const sync = await syncCourse(createdId);
		if (!sync.ok) throw new Error(`${sync.code}: ${sync.message}`);
		if (!sync.scan.lessons.length)
			throw new Error(
				"No supported videos found during sync. The folder may have changed.",
			);
		if (sync.scan.root_path !== scan.root_path)
			throw new Error(
				"The course folder changed during sync. Please browse again.",
			);
		const registration = await registerCourseRoot(createdId, scan.root_path);
		if (registration.status !== "registered")
			throw new Error(registration.message);
	} catch (error) {
		let message = errorMessage(error);
		if (createdId !== undefined) {
			try {
				await courses.delete(createdId);
			} catch (rollback) {
				message += ` Rollback failed: could not delete newly created course #${createdId}: ${errorMessage(rollback)}`;
			}
		}
		adding = false;
		throw new Error(message);
	}
	try {
		return {
			courseId: createdId,
			warning: input.cover ? await saveCover(createdId, input.cover) : null,
		};
	} finally {
		adding = false;
	}
}
