import { appDataDir, join } from "@tauri-apps/api/path";
import {
	mkdir,
	readFile,
	remove,
	stat,
	writeFile,
} from "@tauri-apps/plugin-fs";
import { errorMessage } from "@/features/library/add-course/folders";
import {
	type CoverKind,
	coverFileName,
	coverKind,
	maxCoverBytes,
} from "@/features/library/add-course/model";
import { updateCover } from "@/lib/db/courses";

export interface PickedCover {
	bytes: Uint8Array;
	kind: CoverKind;
}
export function coverBlob(cover: PickedCover): Blob {
	return new Blob([new Uint8Array(cover.bytes)], {
		type: cover.kind === "jpg" ? "image/jpeg" : `image/${cover.kind}`,
	});
}

export async function readCover(path: string): Promise<PickedCover> {
	if (!/\.(png|jpe?g|webp)$/i.test(path))
		throw new Error("Choose a PNG, JPEG or WebP image. SVG is not supported.");
	const info = await stat(path);
	if (!info.isFile) throw new Error("Choose an image file.");
	if (info.size > maxCoverBytes)
		throw new Error("Cover image must be 10 MB or smaller.");
	const bytes = await readFile(path);
	if (bytes.byteLength > maxCoverBytes)
		throw new Error("Cover image must be 10 MB or smaller.");
	const kind = coverKind(bytes);
	if (!kind)
		throw new Error("The file is not a valid PNG, JPEG or WebP image.");
	return { bytes, kind };
}

export async function saveCover(
	courseId: number,
	cover: PickedCover,
): Promise<string | null> {
	let createdPath: string | undefined;
	try {
		const folder = await join(await appDataDir(), "covers");
		// Only the covers target needs an allow scope. Recursive mkdir creates absent parents.
		await mkdir(folder, { recursive: true });
		const path = await join(
			folder,
			coverFileName(courseId, cover.kind, crypto.randomUUID()),
		);
		try {
			await writeFile(path, cover.bytes, { createNew: true });
			createdPath = path;
		} catch (error) {
			// writeFile may have created a partial file; never remove a collision.
			if (!/already exists|file exists|os error 17/i.test(errorMessage(error)))
				createdPath = path;
			throw error;
		}
		await updateCover(courseId, path);
		return null;
	} catch (error) {
		let warning = `Course added, but the cover wasn't saved: ${errorMessage(error)}`;
		if (createdPath) {
			try {
				await remove(createdPath);
			} catch (cleanup) {
				warning += ` Cover cleanup also failed (${createdPath}): ${errorMessage(cleanup)}`;
			}
		}
		return warning;
	}
}
