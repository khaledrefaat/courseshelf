import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

const read = (path: string) =>
	readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const pkg = JSON.parse(read("package.json"));

it("sets the Linux-only renderer default at main entry, preserving pre-set environment values", () => {
	const entry = read("src-tauri/src/main.rs").split("fn main() {")[1];
	expect(entry).toMatch(
		/^\s*#\[cfg\(target_os = "linux"\)\]\s*if std::env::var_os\("WEBKIT_DISABLE_DMABUF_RENDERER"\)\.is_none\(\)/,
	);
	const startup = entry.slice(0, entry.indexOf("courseshelf_lib::run()"));
	expect(startup).toContain(
		'unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") }',
	);
	expect(startup).toContain("SAFETY:");
	expect(startup).not.toMatch(/thread::spawn|tauri::Builder/);
});

it("keeps app version and the Cargo root lock entry consistent", () => {
	const version = pkg.version;
	expect(version).toBe("0.3.1");
	expect(JSON.parse(read("src-tauri/tauri.conf.json")).version).toBe(version);
	expect(
		read("src-tauri/Cargo.toml").match(
			/\[package\][\s\S]*?\nversion = "([^"]+)"/,
		)?.[1],
	).toBe(version);
	expect(read("src-tauri/Cargo.lock")).toContain(
		`name = "courseshelf"\nversion = "${version}"`,
	);
});

it("pins frontend tooling and includes the requested repeatable quality gates", () => {
	expect(read(".nvmrc").trim()).toMatch(/^\d+\.\d+\.\d+$/);
	expect(pkg.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
	expect(pkg.scripts.check).toBe("pnpm typecheck && pnpm lint && pnpm test");
	for (const script of [
		"typecheck",
		"lint",
		"lint:fix",
		"format",
		"test",
		"check:rust",
	])
		expect(typeof pkg.scripts[script]).toBe("string");
	expect(pkg.scripts["check:rust"]).toContain("-- -D warnings");
	expect(JSON.parse(read("biome.json")).css.parser.tailwindDirectives).toBe(
		true,
	);
});

it("removes the isolated spike and its localStorage wiring without removing real playback", () => {
	for (const file of [
		"VideoSpike.tsx",
		"CourseScanTest.tsx",
		"useCourseScanCheck.ts",
		"lastTestCourse.ts",
	])
		expect(
			existsSync(new URL(`../src/features/course/${file}`, import.meta.url)),
		).toBe(false);
	expect(read("src/App.tsx")).not.toContain("/dev/spike");
	expect(read("src/main.tsx")).not.toMatch(/console\.(?:log|debug)\(/);
	expect(read("src/features/course/LessonPlayer.tsx")).toContain(
		"getLessonUrl",
	);
	expect(read("src/features/course/LessonPlayer.tsx")).toContain(
		"trackPlayback",
	);
});

it("keeps CI read-only with separate frontend/Rust gates and major-pinned actions", () => {
	const workflow = read(".github/workflows/ci.yml");
	expect(workflow).toContain("contents: read");
	expect(workflow).toContain("  push:");
	expect(workflow).toContain("  pull_request:");
	expect(workflow).toContain("pnpm install --frozen-lockfile");
	for (const step of [
		"pnpm typecheck",
		"pnpm lint",
		"pnpm test",
		"cargo fmt --check",
		"cargo clippy --locked --all-targets -- -D warnings",
		"cargo test --locked",
	])
		expect(workflow).toContain(step);
	const actions = [...workflow.matchAll(/uses: ([^\s]+)/g)].map(
		(match) => match[1],
	);
	expect(actions.length).toBeGreaterThan(0);
	for (const action of actions) expect(action).toMatch(/@v\d+$/);
	expect(workflow).not.toMatch(
		/secrets\.|contents: write|pull_request_target|pnpm tauri build/,
	);
});
