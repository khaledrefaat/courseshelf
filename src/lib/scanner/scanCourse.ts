import { invoke } from "@tauri-apps/api/core";
import { buildCourseStructure } from "@/lib/scanner/structure";

interface FolderScan {
	root_path: string;
	relative_paths: string[];
	skipped_symlink_count: number;
}

export async function scanCourse(root: string) {
	const scan = await invoke<FolderScan>("scan_course_folder", { root });
	return {
		root_path: scan.root_path,
		skipped_symlink_count: scan.skipped_symlink_count,
		...buildCourseStructure(scan.relative_paths),
	};
}
