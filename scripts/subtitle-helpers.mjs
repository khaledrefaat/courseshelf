// Build-time tooling only. Never executed by the installed app.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
	chmod,
	copyFile,
	mkdir,
	readFile,
	statfs,
	writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const trial = join(root, "subtitle-trial.local");
const downloads = join(trial, "downloads");
const target = join(root, "src-tauri/resources/subtitle-helpers/whisper");
const win = process.platform === "win32";
if (!["linux", "win32"].includes(process.platform) || process.arch !== "x64")
	throw new Error("Subtitle helpers currently support Linux/Windows x64 only.");
await mkdir(downloads, { recursive: true });
await mkdir(target, { recursive: true });
const disk = await statfs(root);
if (disk.bavail * disk.bsize < 1_500_000_000)
	throw new Error("Free at least 1.5 GB before preparing subtitle helpers.");
function run(command, args, cwd = trial) {
	const result = spawnSync(command, args, {
		cwd,
		stdio: "inherit",
		shell: false,
	});
	if (result.error || result.status !== 0)
		throw result.error ?? new Error(`${command} failed (${result.status})`);
}
async function hash(path) {
	const sha = createHash("sha256");
	for await (const chunk of createReadStream(path)) sha.update(chunk);
	return sha.digest("hex");
}
async function download(url, name, digest) {
	const path = join(downloads, name);
	try {
		if ((await hash(path)) === digest) return path;
	} catch {
		/* Download missing cache. */
	}
	run("curl", [
		"--fail",
		"--location",
		"--retry",
		"2",
		"--proto",
		"=https",
		"--output",
		path,
		url,
	]);
	if ((await hash(path)) !== digest)
		throw new Error(`Checksum mismatch: ${name}. No helper installed.`);
	return path;
}
const source = await download(
	"https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/d1be6fde11ac6e0407606b4e42fe72d34add8037",
	"whisper.tar.gz",
	"645445da884df6dbd52b30f82d7be7c01d1767c938714e477e786b88d529e9f4",
);
run("tar", ["-xf", source, "-C", trial]);
const whisper = join(
	trial,
	"whisper.cpp-d1be6fde11ac6e0407606b4e42fe72d34add8037",
);
let cmake = "cmake";
if (!win && spawnSync(cmake, ["--version"]).status !== 0) {
	const name = "cmake-3.31.6-linux-x86_64.tar.gz";
	const checksum = join(downloads, "cmake-checksums.txt");
	run("curl", [
		"--fail",
		"--location",
		"--proto",
		"=https",
		"--output",
		checksum,
		"https://github.com/Kitware/CMake/releases/download/v3.31.6/cmake-3.31.6-SHA-256.txt",
	]);
	const digest = (await readFile(checksum, "utf8"))
		.split("\n")
		.find((line) => line.endsWith(`  ${name}`))
		?.split(/\s+/)[0];
	if (!digest || !/^[a-f0-9]{64}$/.test(digest))
		throw new Error("CMake checksum unavailable.");
	const archive = await download(
		`https://github.com/Kitware/CMake/releases/download/v3.31.6/${name}`,
		name,
		digest,
	);
	run("tar", ["-xf", archive, "-C", trial]);
	cmake = join(trial, "cmake-3.31.6-linux-x86_64/bin/cmake");
}
// Ship both variants: never require the build machine's instruction set at runtime.
for (const optimized of [false, true]) {
	const build = join(whisper, optimized ? "build-avx2" : "build");
	const enabled = optimized ? "ON" : "OFF";
	run(cmake, [
		"-S",
		whisper,
		"-B",
		build,
		"-DCMAKE_BUILD_TYPE=Release",
		"-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded",
		"-DBUILD_SHARED_LIBS=OFF",
		"-DGGML_NATIVE=OFF",
		"-DGGML_OPENMP=OFF",
		`-DGGML_SSE42=${enabled}`,
		`-DGGML_BMI2=${enabled}`,
		`-DGGML_AVX=${enabled}`,
		`-DGGML_AVX2=${enabled}`,
		`-DGGML_FMA=${enabled}`,
		`-DGGML_F16C=${enabled}`,
		"-DGGML_AVX512=OFF",
		"-DWHISPER_BUILD_TESTS=OFF",
		"-DWHISPER_BUILD_EXAMPLES=ON",
	]);
	run(cmake, [
		"--build",
		build,
		"--config",
		"Release",
		"--target",
		"whisper-cli",
		"-j",
		"4",
	]);
	await copyFile(
		join(
			build,
			"bin",
			...(win ? ["Release", "whisper-cli.exe"] : ["whisper-cli"]),
		),
		join(target, `whisper-cli${optimized ? "-avx2" : ""}${win ? ".exe" : ""}`),
	);
}
await copyFile(join(whisper, "LICENSE"), join(target, "WHISPER-LICENSE.txt"));
await writeFile(
	join(target, "BUILD-SOURCES.txt"),
	`whisper.cpp v1.9.5: https://github.com/ggml-org/whisper.cpp/tree/d1be6fde11ac6e0407606b4e42fe72d34add8037\nPortable and AVX2 CPU-only builds. These executables are separate processes, not linked into Courseshelf. Preserve WHISPER-LICENSE.txt when redistributing.\nFFmpeg is not bundled; the app downloads its pinned upstream release after consent.\n`,
);
if (!win)
	for (const name of ["whisper-cli", "whisper-cli-avx2"])
		await chmod(join(target, name), 0o755);
console.log(
	"Prepared pinned Whisper helpers. FFmpeg and the model download separately after consent.",
);
