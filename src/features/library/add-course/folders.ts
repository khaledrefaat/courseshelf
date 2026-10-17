import { invoke } from "@tauri-apps/api/core";
import { list } from "@/lib/db/courses";

export const canonicalizeRoot = (root: string) =>
	invoke<string>("canonicalize_course_root", { root });

export function errorMessage(error: unknown): string {
	const message =
		typeof error === "object" && error !== null && "message" in error
			? String(error.message)
			: String(error);
	return message.replace(/https?:\/\/\S+/gi, "[URL omitted]");
}

export async function findDuplicate(root: string): Promise<boolean> {
	const canonical = await canonicalizeRoot(root);
	for (const course of await list()) {
		if (course.root_path === canonical) return true;
		try {
			if ((await canonicalizeRoot(course.root_path)) === canonical) return true;
		} catch (error) {
			// A genuinely missing path cannot resolve to this existing picked root.
			// Do not silently overlook an inaccessible legacy alias.
			if (
				typeof error === "object" &&
				error !== null &&
				"code" in error &&
				error.code === "ROOT_UNREADABLE" &&
				/no such file|not found|os error 2\b/i.test(errorMessage(error))
			)
				continue;
			throw new Error(
				`Could not verify the folder of “${course.title}” for duplicates. Re-pick its folder before trying again. ${errorMessage(error)}`,
			);
		}
	}
	return false;
}
