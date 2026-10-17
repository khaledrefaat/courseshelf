import { appDataDir } from "@tauri-apps/api/path";
import { readFile } from "@tauri-apps/plugin-fs";

interface Entry {
	promise: Promise<string | null>;
	url?: string;
	disposed: boolean;
}
const cache = new Map<string, Entry>();
let owners = 0;
let cleanup: ReturnType<typeof setTimeout> | undefined;

// Owned by the Library page, not individual cards: filtering doesn't revoke URLs.
export function retainCoverCache(): () => void {
	owners++;
	clearTimeout(cleanup);
	return () => {
		owners--;
		cleanup = setTimeout(() => {
			if (owners !== 0) return;
			for (const entry of cache.values()) {
				entry.disposed = true;
				if (entry.url) URL.revokeObjectURL(entry.url);
			}
			cache.clear();
		}, 0);
	};
}

export function loadCover(path: string): Promise<string | null> {
	const existing = cache.get(path);
	if (existing) return existing.promise;
	const entry: Entry = { disposed: false, promise: Promise.resolve(null) };
	entry.promise = (async () => {
		const root = `${(await appDataDir()).replace(/\/$/, "")}/covers/`;
		const fullPath = path.startsWith("/")
			? path
			: `${root}${path.replace(/^covers\//, "")}`;
		if (
			!fullPath.startsWith(root) ||
			fullPath
				.slice(root.length)
				.split("/")
				.some(
					(part) =>
						!part || part === "." || part === ".." || part.includes("\\"),
				)
		)
			return null;
		const extension = fullPath.split(".").pop()?.toLowerCase();
		const mime = (
			{
				png: "image/png",
				jpg: "image/jpeg",
				jpeg: "image/jpeg",
				webp: "image/webp",
				gif: "image/gif",
				avif: "image/avif",
			} as Record<string, string>
		)[extension ?? ""];
		if (!mime) return null;
		const bytes = await readFile(fullPath);
		if (entry.disposed) return null;
		entry.url = URL.createObjectURL(
			new Blob([new Uint8Array(bytes)], { type: mime }),
		);
		return entry.url;
	})().catch(() => null);
	cache.set(path, entry);
	return entry.promise;
}
