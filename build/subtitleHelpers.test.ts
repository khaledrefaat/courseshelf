import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const read = (path: string) =>
	readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
it("packages only Whisper, not FFmpeg or the English model, without new frontend grants or remote CSP", () => {
	const config = JSON.parse(read("src-tauri/tauri.conf.json"));
	expect(config.bundle.resources).toEqual({
		"resources/subtitle-helpers/whisper/": "subtitle-helpers/whisper/",
	});
	expect(JSON.stringify(config.bundle)).not.toContain("ggml-base.en.bin");
	expect(config.app.security.csp["connect-src"]).toBe(
		"ipc: http://ipc.localhost",
	);
	expect(read("src-tauri/capabilities/default.json")).not.toMatch(
		/shell:|http:|subtitles\/\*\*/,
	);
	const script = read("scripts/subtitle-helpers.mjs");
	expect(script).toContain('createHash("sha256")');
	expect(script).toContain("Checksum mismatch");
	expect(script).not.toContain("sudo");
	expect(script).not.toContain("FFmpeg-Builds/releases/download");
	expect(read("src-tauri/build.rs")).not.toContain('"ffmpeg"');
	expect(read(".github/workflows/windows-build.yml")).toContain(
		"pnpm prepare:subtitles",
	);
});
it("prepares both portable and optimized helpers without machine-native compiler flags", () => {
	const script = read("scripts/subtitle-helpers.mjs");
	expect(script).toContain("for (const optimized of [false, true])");
	expect(script).toContain('"-DGGML_NATIVE=OFF"');
	for (const feature of ["SSE42", "BMI2", "AVX", "AVX2", "FMA", "F16C"])
		expect(script).toContain(`-DGGML_${feature}=\u0024{enabled}`);
	expect(script).toContain('"-DGGML_AVX512=OFF"');
	expect(read("src-tauri/build.rs")).toContain('"whisper-cli-avx2"');
});
