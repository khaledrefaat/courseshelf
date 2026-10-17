export const maxCoverBytes = 10 * 1024 * 1024;
export type CoverKind = "png" | "jpg" | "webp";

export function titleFromFolder(path: string): string {
	return (path.replace(/\/+$/, "").split("/").pop() ?? "")
		.replace(/[-_]/g, " ")
		.trim();
}

export function formatIgnored(
	counts: Readonly<Record<string, number>>,
): string[] {
	return Object.entries(counts)
		.filter(([, count]) => count > 0)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(
			([extension, count]) =>
				`${count} ${extension} ${count === 1 ? "file" : "files"} ignored: not supported yet`,
		);
}

export function coverFileName(
	courseId: number,
	kind: CoverKind,
	uuid: string,
): string {
	if (
		!Number.isSafeInteger(courseId) ||
		courseId < 1 ||
		!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(uuid)
	)
		throw new Error("Invalid cover file name input");
	return `${courseId}-${uuid}.${kind}`;
}

export function coverKind(bytes: Uint8Array): CoverKind | null {
	const matches = (values: number[], offset = 0) =>
		values.every((value, i) => bytes[offset + i] === value);
	if (
		bytes.length >= 24 &&
		matches([137, 80, 78, 71, 13, 10, 26, 10]) &&
		matches([73, 72, 68, 82], 12)
	)
		return "png";
	if (
		bytes.length >= 4 &&
		matches([255, 216, 255]) &&
		bytes[3] !== 0 &&
		bytes[3] !== 255
	)
		return "jpg";
	if (
		bytes.length >= 16 &&
		matches([82, 73, 70, 70]) &&
		matches([87, 69, 66, 80], 8) &&
		(matches([86, 80, 56, 32], 12) ||
			matches([86, 80, 56, 76], 12) ||
			matches([86, 80, 56, 88], 12))
	)
		return "webp";
	return null;
}

export interface Validation {
	saving: boolean;
	scanning: boolean;
	folder: string;
	scanError: string | null;
	duplicate: boolean;
	lessonCount: number | null;
	title: string;
	coverBusy: boolean;
	coverError: string | null;
}
// Busy state wins, then folder validity, then title and cover validity.
export function validationMessage(state: Validation): string | null {
	if (state.saving) return "Adding course…";
	if (state.scanning) return "Scanning folder…";
	if (!state.folder) return "Choose a course folder.";
	if (state.scanError) return state.scanError;
	if (state.duplicate) return "This folder is already in your library";
	if (state.lessonCount === null) return "Scan the folder before adding it.";
	if (state.lessonCount === 0)
		return "No supported videos found. Choose a folder containing MP4, M4V or WebM files.";
	if (!state.title.trim()) return "Enter a course title.";
	if (state.title.trim().length > 120)
		return "Course title must be 120 characters or fewer.";
	if (state.coverBusy) return "Checking cover image…";
	return state.coverError;
}

// Invalidates results as soon as a second picker opens, even when it is cancelled.
export function latestRequest() {
	let version = 0;
	return {
		next: () => ++version,
		isCurrent: (id: number) => version === id,
		cancel: () => {
			version++;
		},
	};
}
