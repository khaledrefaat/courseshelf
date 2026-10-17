import {
	canonicalizeRoot,
	findDuplicate,
} from "@/features/library/add-course/folders";
import { scanCourse } from "@/lib/scanner/scanCourse";

export async function previewFolder(picked: string) {
	const root = await canonicalizeRoot(picked);
	const scan = await scanCourse(root);
	return { scan, duplicate: await findDuplicate(scan.root_path) };
}

// A small async runner shared by the hook and its race-condition tests.
export function createFolderRequest() {
	let version = 0;
	return {
		cancel() {
			version++;
		},
		async run(
			pick: () => Promise<string | null>,
			onPicked: (path: string) => void,
			onResult: (result: Awaited<ReturnType<typeof previewFolder>>) => void,
			onError: (cause: unknown) => void,
			onDone: () => void,
		) {
			const id = ++version;
			try {
				const path = await pick();
				if (id !== version || !path) return;
				onPicked(path);
				const result = await previewFolder(path);
				if (id === version) onResult(result);
			} catch (error) {
				if (id === version) onError(error);
			} finally {
				if (id === version) onDone();
			}
		},
	};
}
