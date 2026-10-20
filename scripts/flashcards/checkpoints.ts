// Local checkpoint inspection only. Never reissues an incomplete API request.
import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Cue, MODEL, PROMPT_VERSION } from "./core.ts";

export const SELECTION_STAGE = "Deduplicate and select whole-lesson cards";
export const extractionStage = (index: number) =>
	`Extract section ${index + 1}`;
export const hash = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
export const counter = (value: unknown) =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: null;
export interface Usage {
	promptTokens: number | null;
	completionTokens: number | null;
	totalTokens: number | null;
}
export interface SavedStage {
	stage: string;
	bytes: Buffer;
	content: unknown;
	usage: Usage;
	promptVersion: string;
}
export interface Checkpoint {
	run: string;
	reportSha256: string;
	stages: Map<string, SavedStage>;
}
const outputRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../flashcard-trial.local",
);
const versions = [
	"flashcards-trial-2",
	"flashcards-trial-3",
	"flashcards-trial-4",
	"flashcards-trial-5",
	"flashcards-trial-6",
	"flashcards-trial-7",
	PROMPT_VERSION,
];
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid checkpoint metadata.");
	return value as Record<string, unknown>;
}
async function read(path: string, limit: number): Promise<Buffer> {
	const info = await lstat(path);
	if (!info.isFile() || info.isSymbolicLink() || info.size > limit)
		throw new Error(
			"Checkpoint inputs must be regular files within size limits.",
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
			throw new Error("Checkpoint grew beyond its size limit.");
		return bytes.subarray(0, length);
	} finally {
		await handle.close();
	}
}
function json(bytes: Buffer): unknown {
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch {
		throw new Error("Checkpoint is not valid UTF-8 JSON.");
	}
}
export async function loadCheckpoint(
	directory: string,
	sourceSha256: string,
	sections: readonly Cue[][],
): Promise<Checkpoint> {
	const run = resolve(directory);
	if (
		dirname(run) !== outputRoot ||
		!/^run-[A-Za-z0-9]+$/.test(basename(run)) ||
		(await realpath(outputRoot)) !== outputRoot ||
		(await realpath(run)) !== run ||
		!(await lstat(run)).isDirectory()
	)
		throw new Error(
			"Choose a regular run directory directly inside flashcard-trial.local.",
		);
	const bytes = await read(join(run, "report.json"), 65_536),
		report = object(json(bytes));
	if (report.sourceSha256 !== sourceSha256)
		throw new Error("Transcript fingerprint does not match the checkpoint.");
	const boundaries = sections.map((section) => ({
		firstCue: section[0].id,
		lastCue: section.at(-1)?.id,
	}));
	if (
		report.model !== MODEL ||
		!versions.includes(String(report.version)) ||
		!["api", "dry-run"].includes(String(report.mode)) ||
		report.cueCount !== sections.flat().length ||
		JSON.stringify(report.sections) !== JSON.stringify(boundaries)
	)
		throw new Error(
			"Checkpoint model, version or section boundaries are incompatible.",
		);
	if (
		!Array.isArray(report.requests) ||
		(report.reusedRequests !== undefined &&
			!Array.isArray(report.reusedRequests))
	)
		throw new Error("Invalid checkpoint requests.");
	const reused = (report.reusedRequests ?? []) as unknown[];
	if (reused.length + report.requests.length > sections.length + 1)
		throw new Error("Checkpoint has too many requests.");
	const records: Record<string, unknown>[] = [
		...reused.map((value) => object(value)),
		...report.requests.map((value, index) => {
			const row = object(value);
			return {
				...row,
				responseFile:
					row.responseFile ?? `response-${index + 1}.unvalidated.json`,
			};
		}),
	];
	const stages = new Map<string, SavedStage>(),
		positions = new Set<number>();
	for (const row of records) {
		const position =
			row.stage === SELECTION_STAGE
				? sections.length
				: sections.findIndex(
						(_, index) => row.stage === extractionStage(index),
					);
		if (position < 0 || positions.has(position))
			throw new Error("Checkpoint stages are unknown or duplicated.");
		positions.add(position);
		if (row.status !== "received")
			throw new Error(
				"Checkpoint contains an incomplete or failed request. It will not be automatically retried; inspect it before starting a fresh run.",
			);
		if (
			typeof row.responseFile !== "string" ||
			!/^(?:response|reused)-[1-9]\d*\.unvalidated\.json$/.test(
				row.responseFile,
			)
		)
			throw new Error("Invalid checkpoint response filename.");
		const response = await read(join(run, row.responseFile), 1_048_576);
		if (
			row.responseSha256 !== undefined &&
			row.responseSha256 !== hash(response)
		)
			throw new Error("Checkpoint response fingerprint does not match.");
		const usage = object(row.usage),
			promptVersion = String(row.originalPromptVersion ?? report.version);
		if (!versions.includes(promptVersion))
			throw new Error("Incompatible saved response prompt version.");
		const stage = String(row.stage);
		stages.set(stage, {
			stage,
			bytes: response,
			content: json(response),
			promptVersion,
			usage: {
				promptTokens: counter(usage.promptTokens),
				completionTokens: counter(usage.completionTokens),
				totalTokens: counter(usage.totalTokens),
			},
		});
	}
	for (let index = 0; index < positions.size; index++) {
		if (!positions.has(index))
			throw new Error(
				"Checkpoint stages are not a complete prefix of this lesson.",
			);
	}
	if (!stages.size)
		throw new Error("Checkpoint has no received responses to reuse.");
	return { run, reportSha256: hash(bytes), stages };
}
