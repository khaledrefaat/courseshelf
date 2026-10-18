import { describe, expect, it } from "vitest";
import {
	coverFileName,
	coverKind,
	formatIgnored,
	titleFromFolder,
	type Validation,
	validationMessage,
} from "@/features/library/add-course/model";
import { buildCourseStructure } from "@/lib/scanner/structure";

const valid: Validation = {
	saving: false,
	scanning: false,
	folder: "/course",
	scanError: null,
	duplicate: false,
	lessonCount: 3,
	title: "Title",
	coverBusy: false,
	coverError: null,
};
describe("add course pure functions", () => {
	it("keeps folder name casing, handles trailing slash and Arabic, replaces separators", () => {
		expect(titleFromFolder("/courses/My-SQL_Course/")).toBe("My SQL Course");
		expect(titleFromFolder("/courses/العربية_SQL")).toBe("العربية SQL");
		expect(titleFromFolder("/courses/Unix\\Course/")).toBe("Unix\\Course");
		for (const root of [
			"C:\\Courses\\My-SQL_Course\\",
			"\\\\?\\C:\\Courses\\My-SQL_Course",
			"\\\\server\\courses\\My-SQL_Course\\",
		])
			expect(titleFromFolder(root)).toBe("My SQL Course");
		expect(titleFromFolder("D:\\Courses\\العربية_SQL")).toBe("العربية SQL");
	});
	it("formats counts by extension and excludes hidden/common junk from warnings", () => {
		const scan = buildCourseStructure([
			"a.MKV",
			"b.mkv",
			"subs.srt",
			"README",
			".DS_Store",
			".hidden/x.mkv",
			"Thumbs.db",
			"Sub/desktop.ini",
			"a.mp4",
		]);
		expect(scan.ignored_count).toBe(8);
		expect(scan.ignored_by_extension).toEqual({
			".mkv": 2,
			"(no extension)": 1,
		});
		expect(formatIgnored({ ".mkv": 12, ".srt": 1, ".pdf": 0 })).toEqual([
			"12 .mkv files ignored: not supported yet",
			"1 .srt file ignored: not supported yet",
		]);
	});
	it("generates safe deterministic names from supplied UUID entropy", () => {
		const uuid = "12345678-1234-1234-1234-123456789abc";
		expect(coverFileName(7, "png", uuid)).toBe(`7-${uuid}.png`);
		expect(() => coverFileName(7, "jpg", "../../escape")).toThrow();
		expect(() => coverFileName(0, "webp", uuid)).toThrow();
		expect(coverFileName(7, "jpg", uuid)).not.toBe(
			coverFileName(8, "jpg", uuid),
		);
	});
	it("recognizes supported magic bytes, rejects SVG and truncated or disguised files", () => {
		const png = new Uint8Array(24);
		png.set([137, 80, 78, 71, 13, 10, 26, 10]);
		png.set([73, 72, 68, 82], 12);
		expect(coverKind(png)).toBe("png");
		expect(coverKind(new Uint8Array([255, 216, 255, 224]))).toBe("jpg");
		expect(coverKind(new TextEncoder().encode("RIFF0000WEBPVP8 "))).toBe(
			"webp",
		);
		for (const bytes of [
			png.slice(0, 8),
			new TextEncoder().encode("<svg></svg>"),
			new Uint8Array([1, 2, 3]),
			new TextEncoder().encode("RIFF0000WAVEXXXX"),
		])
			expect(coverKind(bytes)).toBeNull();
	});
	it("prioritizes saving, scanning, folder errors, duplicates, empty scan, title then cover", () => {
		expect(validationMessage(valid)).toBeNull();
		expect(
			validationMessage({
				...valid,
				saving: true,
				scanning: true,
				duplicate: true,
			}),
		).toBe("Adding course…");
		expect(
			validationMessage({ ...valid, scanning: true, scanError: "Denied" }),
		).toBe("Scanning folder…");
		expect(
			validationMessage({ ...valid, scanError: "Denied", duplicate: true }),
		).toBe("Denied");
		expect(
			validationMessage({
				...valid,
				duplicate: true,
				lessonCount: 0,
				title: "",
			}),
		).toBe("This folder is already in your library");
		expect(
			validationMessage({ ...valid, lessonCount: 0, title: "" }),
		).toContain("No supported videos");
		expect(
			validationMessage({ ...valid, title: "  ", coverError: "Bad image" }),
		).toBe("Enter a course title.");
		expect(validationMessage({ ...valid, title: "x".repeat(121) })).toContain(
			"120",
		);
		expect(
			validationMessage({
				...valid,
				title: " Title ",
				coverError: "Bad image",
			}),
		).toBe("Bad image");
	});
});
