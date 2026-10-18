import { expect, it } from "vitest";
import { resolveCoverPath } from "@/lib/cover-paths";

it("keeps Unix cover paths and relative subfolders working", () => {
	for (const path of ["/app/data/covers/one.png", "covers/one.png", "one.png"])
		expect(resolveCoverPath(path, "/app/data/")).toEqual({
			path: "/app/data/covers/one.png",
			relative: "one.png",
		});
	expect(resolveCoverPath("nested/one.png", "/app/data")?.path).toBe(
		"/app/data/covers/nested/one.png",
	);
});

it("handles drive, UNC and canonical Windows app-data paths without using the host OS", () => {
	for (const root of [
		"C:\\Users\\Khaled\\AppData\\Roaming\\com.khaled.courseshelf",
		"\\\\?\\C:\\Users\\Khaled\\AppData\\Roaming\\com.khaled.courseshelf",
		"\\\\server\\share\\app",
		"\\\\?\\UNC\\server\\share\\app",
	]) {
		for (const stored of [
			`${root}\\covers\\one.png`,
			"covers\\one.png",
			"one.png",
			`${root.replace(/\\/g, "/")}/covers/one.png`,
		])
			expect(resolveCoverPath(stored, `${root}\\`)).toEqual({
				path: `${root}\\covers\\one.png`,
				relative: "one.png",
			});
	}
});

it("never resolves traversal, outside paths, sibling prefixes or Windows alternate streams", () => {
	for (const root of ["/app/data", "C:\\app\\data"]) {
		for (const path of [
			"../one.png",
			"covers/../one.png",
			"./one.png",
			"covers//one.png",
			"one.png\0",
			"/etc/one.png",
			"C:\\other\\one.png",
			"C:/other/one.png",
			"\\\\server\\other\\one.png",
			"C:/app/data/covers-other/one.png",
		])
			expect(resolveCoverPath(path, root)).toBeNull();
	}
	expect(resolveCoverPath("one.png:stream", "C:\\app\\data")).toBeNull();
	for (const path of [".. /one.png", "nested./one.png", "one.png "])
		expect(resolveCoverPath(path, "C:\\app\\data")).toBeNull();
	expect(resolveCoverPath("sub\\one.png", "/app/data")).toBeNull();
});
