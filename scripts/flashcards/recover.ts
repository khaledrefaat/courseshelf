// Offline recovery of one completed section. No API, environment key or app access.
import { createHash } from "node:crypto";
import { lstat, mkdtemp, open, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	cardRange,
	chunks,
	deduplicate,
	MODEL,
	PROMPT_VERSION,
	reviewText,
	transcript,
	VALIDATOR_VERSION,
	validateCards,
	withReferences,
} from "./core.ts";

const outputRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../flashcard-trial.local",
);
const hash = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
async function readBounded(path: string, limit: number): Promise<Buffer> {
	const info = await lstat(path);
	if (!info.isFile() || info.isSymbolicLink() || info.size > limit)
		throw new Error(
			"Recovery inputs must be regular files within size limits.",
		);
	const handle = await open(path, "r");
	try {
		const bytes = Buffer.alloc(limit + 1);
		let length = 0;
		while (length < bytes.length) {
			const { bytesRead } = await handle.read(
				bytes,
				length,
				bytes.length - length,
				length,
			);
			if (!bytesRead) break;
			length += bytesRead;
		}
		if (length > limit)
			throw new Error("Recovery input grew beyond its size limit.");
		return bytes.subarray(0, length);
	} finally {
		await handle.close();
	}
}
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid recovery metadata.");
	return value as Record<string, unknown>;
}
function json(bytes: Buffer): unknown {
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch {
		throw new Error("Recovery input is not valid UTF-8 JSON.");
	}
}

export async function recoverSingleSection(
	runDirectory: string,
	sourcePath: string,
): Promise<string> {
	const run = resolve(runDirectory);
	if (
		dirname(run) !== outputRoot ||
		!/^run-[a-zA-Z0-9]+$/.test(basename(run)) ||
		(await realpath(outputRoot)) !== outputRoot ||
		(await realpath(run)) !== run ||
		!(await lstat(run)).isDirectory()
	)
		throw new Error(
			"Choose a regular run directory directly inside flashcard-trial.local.",
		);
	if (!/\.(vtt|srt)$/i.test(sourcePath))
		throw new Error("Choose the original VTT/SRT transcript.");
	const originalReport = await readBounded(join(run, "report.json"), 65_536);
	const report = object(json(originalReport));
	const source = await readBounded(resolve(sourcePath), 2_097_152);
	if (hash(source) !== report.sourceSha256)
		throw new Error("Transcript fingerprint does not match the original run.");
	const cues = transcript(
		new TextDecoder("utf-8", { fatal: true }).decode(source),
	);
	const sections = chunks(cues);
	const originalSections = report.sections;
	const requests = report.requests;
	if (
		report.model !== MODEL ||
		![
			"flashcards-trial-2",
			"flashcards-trial-3",
			"flashcards-trial-4",
			"flashcards-trial-5",
			"flashcards-trial-6",
			"flashcards-trial-7",
			"flashcards-trial-8",
			PROMPT_VERSION,
		].includes(String(report.version)) ||
		report.mode !== "api" ||
		sections.length !== 1 ||
		!Array.isArray(originalSections) ||
		originalSections.length !== 1 ||
		!Array.isArray(requests) ||
		requests.length !== 1 ||
		object(requests[0]).status !== "received" ||
		report.cueCount !== cues.length ||
		object(originalSections[0]).firstCue !== cues[0].id ||
		object(originalSections[0]).lastCue !== cues.at(-1)?.id
	)
		throw new Error(
			"Offline recovery requires a compatible, received single-section API response.",
		);
	const response = await readBounded(
		join(run, "response-1.unvalidated.json"),
		1_048_576,
	);
	const duration = Math.max(...cues.map((cue) => cue.end)) - cues[0].start;
	const validated = validateCards(
		json(response),
		cues,
		cardRange(duration).max,
	);
	const cards = withReferences(deduplicate(validated.cards), cues);
	const usage = object(report.tokenUsage);
	const counter = (value: unknown) =>
		typeof value === "number" && Number.isSafeInteger(value) && value >= 0
			? value
			: null;
	// No original file is replaced, including on repeated recoveries.
	const output = await mkdtemp(join(run, "recovered-"));
	const write = (name: string, content: string) =>
		writeFile(join(output, name), content, { flag: "wx", mode: 0o600 });
	await write(
		"cards.json",
		JSON.stringify(
			{ cards, quickReviewIds: cards.slice(0, 5).map((card) => card.id) },
			null,
			2,
		),
	);
	await write("review.txt", reviewText(cards, [validated.notes]));
	await write(
		"recovery.json",
		JSON.stringify(
			{
				mode: "offline-recovery",
				status: "validated",
				validatorVersion: VALIDATOR_VERSION,
				normalizations: validated.normalizations,
				originalPromptVersion: report.version,
				originalRun: basename(run),
				originalReportSha256: hash(originalReport),
				originalResponseSha256: hash(response),
				sourceSha256: hash(source),
				createdAt: new Date().toISOString(),
				requestsMade: 0,
				originalReportedUsage: {
					promptTokens: counter(usage.promptTokens),
					completionTokens: counter(usage.completionTokens),
					totalTokens: counter(usage.totalTokens),
				},
				notes:
					"Schema and references revalidated locally, not regenerated or fact-checked. Original API prompt, response and report are unchanged.",
			},
			null,
			2,
		),
	);
	return output;
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const args = process.argv.slice(2);
	if (args.length !== 2 || args.some((arg) => arg.startsWith("--"))) {
		console.error(
			'Usage: node --experimental-strip-types scripts/flashcards/recover.ts "flashcard-trial.local/run-..." "original/lesson.vtt"',
		);
		process.exitCode = 1;
	} else {
		recoverSingleSection(args[0], args[1])
			.then((output) => {
				console.log(
					`Recovered cards offline. No API request or credits used.\nOutput: ${output}`,
				);
			})
			.catch((error: unknown) => {
				console.error(
					error instanceof Error ? error.message : "Recovery failed.",
				);
				process.exitCode = 1;
			});
	}
}
