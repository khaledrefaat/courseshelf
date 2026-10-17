import { beforeEach, expect, it, vi } from "vitest";
import {
	canonicalizeRoot,
	findDuplicate,
} from "@/features/library/add-course/folders";
import { createFolderRequest } from "@/features/library/add-course/previewFolder";
import { scanCourse } from "@/lib/scanner/scanCourse";
import { buildCourseStructure } from "@/lib/scanner/structure";

vi.mock("@/features/library/add-course/folders", () => ({
	canonicalizeRoot: vi.fn(async (path: string) => path),
	findDuplicate: vi.fn(async () => false),
}));
vi.mock("@/lib/scanner/scanCourse", () => ({ scanCourse: vi.fn() }));
const scan = (root: string) => ({
	root_path: root,
	skipped_symlink_count: 0,
	...buildCourseStructure(["one.mp4"]),
});
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(canonicalizeRoot).mockImplementation(async (path) => path);
	vi.mocked(findDuplicate).mockResolvedValue(false);
});

it("discards a late scan after a second folder was picked", async () => {
	const pending = deferred<ReturnType<typeof scan>>();
	vi.mocked(scanCourse).mockImplementation((root) =>
		root === "/first" ? pending.promise : Promise.resolve(scan(root)),
	);
	const request = createFolderRequest();
	const result = vi.fn();
	const error = vi.fn();
	const done = vi.fn();
	const first = request.run(async () => "/first", vi.fn(), result, error, done);
	await vi.waitFor(() => expect(scanCourse).toHaveBeenCalledWith("/first"));
	await request.run(async () => "/second", vi.fn(), result, error, done);
	pending.resolve(scan("/first"));
	await first;
	expect(result).toHaveBeenCalledTimes(1);
	expect(result.mock.calls[0][0].scan.root_path).toBe("/second");
	expect(error).not.toHaveBeenCalled();
	expect(done).toHaveBeenCalledTimes(1);
});
it("discards a running scan when a second picker is cancelled", async () => {
	const pending = deferred<ReturnType<typeof scan>>();
	vi.mocked(scanCourse).mockReturnValue(pending.promise);
	const request = createFolderRequest();
	const result = vi.fn();
	const done = vi.fn();
	const first = request.run(
		async () => "/first",
		vi.fn(),
		result,
		vi.fn(),
		done,
	);
	await vi.waitFor(() => expect(scanCourse).toHaveBeenCalled());
	await request.run(async () => null, vi.fn(), result, vi.fn(), done);
	pending.resolve(scan("/first"));
	await first;
	expect(result).not.toHaveBeenCalled();
	expect(done).toHaveBeenCalledTimes(1);
});
it("discards a running scan after closing the dialog", async () => {
	const pending = deferred<ReturnType<typeof scan>>();
	vi.mocked(scanCourse).mockReturnValue(pending.promise);
	const request = createFolderRequest();
	const result = vi.fn();
	const done = vi.fn();
	const first = request.run(
		async () => "/first",
		vi.fn(),
		result,
		vi.fn(),
		done,
	);
	await vi.waitFor(() => expect(scanCourse).toHaveBeenCalled());
	request.cancel();
	pending.resolve(scan("/first"));
	await first;
	expect(result).not.toHaveBeenCalled();
	expect(done).not.toHaveBeenCalled();
});
