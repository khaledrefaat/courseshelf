import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const read = (path: string) =>
	readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

it("limits the Windows override to packaging, leaving Linux, identity and security alone", () => {
	const base = JSON.parse(read("src-tauri/tauri.conf.json"));
	const windows = JSON.parse(read("src-tauri/tauri.windows.conf.json"));
	expect(base.bundle.targets).toEqual(["deb"]);
	expect(base.identifier).toBe("com.khaled.courseshelf");
	expect(Object.keys(windows).sort()).toEqual(["$schema", "bundle"]);
	expect(windows.bundle.targets).toEqual(["nsis"]);
	expect(windows.bundle.windows.nsis.installMode).toBe("currentUser");
	expect(windows.bundle.windows.webviewInstallMode).toEqual({
		type: "downloadBootstrapper",
		silent: true,
	});
});

it("keeps Windows builds manual and artifact-only, with checks and read-only repository access", () => {
	const workflow = read(".github/workflows/windows-build.yml");
	expect(workflow).toContain("workflow_dispatch:");
	expect(workflow).toContain("contents: read");
	expect(workflow).not.toMatch(
		/contents: write|secrets\.|\n {2}push:|\n {2}pull_request:/,
	);
	expect(workflow).toContain("pnpm install --frozen-lockfile");
	expect(workflow).toContain("pnpm check\n");
	expect(workflow).toContain("pnpm check:rust");
	expect(workflow).toContain(
		"--target x86_64-pc-windows-msvc --bundles nsis -- --locked",
	);
	expect(workflow).toContain("actions/upload-artifact@v4");
	expect(workflow).toContain("if-no-files-found: error");
	expect(workflow).toContain("core.autocrlf false");
});
