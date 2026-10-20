// Explicit CLI trial only. No application integration or database access.
import { createHash, randomUUID } from "node:crypto";
import {
	lstat,
	mkdir,
	mkdtemp,
	open,
	realpath,
	rename,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	counter,
	extractionStage,
	hash,
	loadCheckpoint,
	SELECTION_STAGE,
	type Usage,
} from "./checkpoints.ts";
import {
	type Card,
	cardRange,
	chunks,
	deduplicate,
	extractionMessages,
	MAX_CANDIDATES_PER_SECTION,
	MAX_CHUNKS,
	MAX_EVIDENCE_CUES,
	MAX_INPUT_CHARACTERS,
	MAX_OUTPUT_TOKENS,
	MODEL,
	PROMPT_VERSION,
	reviewText,
	sectionCoverage,
	selectionMessages,
	transcript,
	VALIDATOR_VERSION,
	validateCards,
	validateSelection,
	withReferences,
} from "./core.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const endpoint = "https://api.z.ai/api/paas/v4/chat/completions";
const MAX_RESPONSE_BYTES = 1_048_576;
interface RequestRecord {
	stage: string;
	requestId: string;
	status: "started" | "received" | "failed";
	seconds: number;
	inputCharacters: number;
	responseFile: string;
	responseSha256?: string;
	usage: Usage;
}
function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("API returned an invalid object.");
	return value as Record<string, unknown>;
}
async function responseJson(response: Response): Promise<unknown> {
	const reader = response.body?.getReader();
	if (!reader) throw new Error("API returned no body.");
	const pieces: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const part = await reader.read();
			if (part.done) break;
			size += part.value.length;
			if (size > MAX_RESPONSE_BYTES)
				throw new Error("API response exceeded the trial limit.");
			pieces.push(part.value);
		}
		return JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(pieces)),
		);
	} finally {
		await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
}
export async function runTrial(args: string[], fetcher: typeof fetch = fetch) {
	const send = args.includes("--send");
	if (args.includes("--help") || !args.length) {
		console.log(
			'Usage: pnpm trial:flashcards "path/to/lesson.vtt" [--resume "flashcard-trial.local/run-..."] [--send]\nDefault: local preparation only. --send uploads transcript text to Z.ai and consumes API credits.',
		);
		return;
	}
	const paths: string[] = [];
	let resumeDirectory: string | undefined;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--send") continue;
		if (arg === "--resume") {
			if (
				resumeDirectory ||
				!args[index + 1] ||
				args[index + 1].startsWith("--")
			)
				throw new Error("Provide one run directory after --resume.");
			resumeDirectory = args[++index];
		} else if (arg.startsWith("--")) throw new Error("Unknown trial option.");
		else paths.push(arg);
	}
	if (paths.length !== 1 || args.filter((arg) => arg === "--send").length > 1)
		throw new Error("Provide one VTT/SRT path and optional --resume/--send.");
	const source = resolve(paths[0]);
	if (!/\.(vtt|srt)$/i.test(source))
		throw new Error("Choose a VTT or SRT transcript.");
	const info = await lstat(source);
	if (!info.isFile() || info.isSymbolicLink() || info.size > 2_097_152)
		throw new Error("Transcript must be a regular file, at most 2 MiB.");
	const handle = await open(source, "r");
	let bytes: Buffer;
	try {
		bytes = Buffer.alloc(2_097_153);
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
		if (length > 2_097_152) throw new Error("Transcript grew beyond 2 MiB.");
		bytes = bytes.subarray(0, length);
	} finally {
		await handle.close();
	}
	const cues = transcript(
			new TextDecoder("utf-8", { fatal: true }).decode(bytes),
		),
		sections = chunks(cues);
	const seconds = Math.max(...cues.map((cue) => cue.end)) - cues[0].start,
		range = cardRange(seconds);
	const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
	const checkpoint = resumeDirectory
		? await loadCheckpoint(resumeDirectory, sourceSha256, sections)
		: undefined;
	const cachedExtractions = new Map<number, ReturnType<typeof validateCards>>();
	for (let index = 0; index < sections.length; index++) {
		const saved = checkpoint?.stages.get(extractionStage(index));
		if (saved)
			cachedExtractions.set(
				index,
				validateCards(
					saved.content,
					sections[index],
					MAX_CANDIDATES_PER_SECTION,
				),
			);
	}
	const cachedCandidates = deduplicate(
		[...cachedExtractions.values()].flatMap((result) => result.cards),
	);
	const cachedSelection = checkpoint?.stages.get(SELECTION_STAGE);
	if (cachedSelection)
		validateSelection(cachedSelection.content, cachedCandidates, range.max);
	const missingSections = sections.length - cachedExtractions.size;
	const maximumRequests =
		missingSections +
		(!cachedSelection &&
		(missingSections > 0 ||
			(cachedCandidates.length > 0 &&
				(sections.length > 1 || cachedCandidates.length > range.max)))
			? 1
			: 0);
	const key = process.env.ZAI_API_KEY?.trim();
	if (send && maximumRequests > 0 && !key)
		throw new Error(
			"ZAI_API_KEY is not configured. Set it privately in your terminal; do not paste it into chat.",
		);
	if (key && /[\r\n]/.test(key)) throw new Error("Invalid API key format.");
	const outputRoot = join(root, "flashcard-trial.local");
	await mkdir(outputRoot, { recursive: true, mode: 0o700 });
	if (
		(await lstat(outputRoot)).isSymbolicLink() ||
		(await realpath(outputRoot)) !== outputRoot
	)
		throw new Error("Trial output must be a regular repo-owned directory.");
	const output = await mkdtemp(join(outputRoot, "run-"));
	const requests: RequestRecord[] = [];
	const reusedRequests: {
		stage: string;
		status: "received";
		responseFile: string;
		responseSha256: string;
		sourceRun: string;
		sourceReportSha256: string;
		originalPromptVersion: string;
		usage: Usage;
	}[] = [];
	const report = {
		version: PROMPT_VERSION,
		validatorVersion: VALIDATOR_VERSION,
		model: MODEL,
		contextPolicy:
			"Answers are transcript-derived. Optional extraContext is scoped AI-added background, not independently verified or supported by transcript citations. Unseen visuals are not reconstructed.",
		source: basename(source),
		sourceSha256,
		createdAt: new Date().toISOString(),
		mode: send ? "api" : "dry-run",
		status: "prepared",
		transcriptSeconds: seconds,
		cueCount: cues.length,
		suggestedCardRange: range,
		sections: sections.map((section) => ({
			firstCue: section[0].id,
			lastCue: section.at(-1)?.id,
		})),
		limits: {
			maximumRequests,
			maximumCandidatesPerSection: MAX_CANDIDATES_PER_SECTION,
			maximumCuesPerCard: MAX_EVIDENCE_CUES,
			maximumOutputTokensPerRequest: MAX_OUTPUT_TOKENS,
			maximumOutputTokensRequested: maximumRequests * MAX_OUTPUT_TOKENS,
		},
		requests,
		reusedRequests,
		coverage: [] as ReturnType<typeof sectionCoverage>,
		normalizations: [] as {
			section: number;
			duplicateReferencesRemoved: number;
			cardsAffected: number;
			detailsFile: string;
		}[],
		candidateCounts: [] as {
			section: number;
			requested: number;
			received: number;
			reused: boolean;
		}[],
		tokenUsage: {
			promptTokens: null as number | null,
			completionTokens: null as number | null,
			totalTokens: null as number | null,
		},
		notes: [] as string[],
		error: null as string | null,
	};
	async function saveReport() {
		const sum = (field: keyof RequestRecord["usage"]) =>
			requests.length && requests.every((row) => row.usage[field] !== null)
				? requests.reduce((total, row) => total + (row.usage[field] ?? 0), 0)
				: null;
		report.tokenUsage = {
			promptTokens: sum("promptTokens"),
			completionTokens: sum("completionTokens"),
			totalTokens: sum("totalTokens"),
		};
		await writeFile(
			join(output, "report.tmp"),
			JSON.stringify(report, null, 2),
			{ mode: 0o600 },
		);
		await rename(join(output, "report.tmp"), join(output, "report.json"));
	}
	const messages = sections.map((section) =>
		extractionMessages(section, sections.length === 1 ? range.max : 12, range),
	);
	if (checkpoint) {
		for (const saved of checkpoint.stages.values()) {
			const responseFile = `reused-${reusedRequests.length + 1}.unvalidated.json`;
			await writeFile(join(output, responseFile), saved.bytes, {
				flag: "wx",
				mode: 0o600,
			});
			reusedRequests.push({
				stage: saved.stage,
				status: "received",
				responseFile,
				responseSha256: hash(saved.bytes),
				sourceRun: basename(checkpoint.run),
				sourceReportSha256: checkpoint.reportSha256,
				originalPromptVersion: saved.promptVersion,
				usage: saved.usage,
			});
		}
	}
	async function storeSection(
		index: number,
		result: ReturnType<typeof validateCards>,
		reused: boolean,
	) {
		report.notes.push(result.notes);
		if (result.normalizations.length) {
			const duplicateReferencesRemoved = result.normalizations.reduce(
				(total, row) => total + row.removed,
				0,
			);
			const detailsFile = `section-${index + 1}.normalizations.json`;
			report.normalizations.push({
				section: index + 1,
				duplicateReferencesRemoved,
				cardsAffected: new Set(
					result.normalizations.map((row) => row.cardIndex),
				).size,
				detailsFile,
			});
			report.notes.push(
				`Section ${index + 1}: collapsed ${duplicateReferencesRemoved} repeated cue reference(s) after validating every raw entry. Original response unchanged; details in ${detailsFile}.`,
			);
			await writeFile(
				join(output, detailsFile),
				JSON.stringify(result.normalizations, null, 2),
				{ flag: "wx", mode: 0o600 },
			);
		}
		const requested = sections.length === 1 ? range.max : 12;
		report.candidateCounts.push({
			section: index + 1,
			requested,
			received: result.cards.length,
			reused,
		});
		if (result.cards.length > requested)
			report.notes.push(
				`Section ${index + 1} returned ${result.cards.length} candidates (requested ${requested}); all were validated and retained for selection.`,
			);
		await writeFile(
			join(output, `section-${index + 1}.json`),
			JSON.stringify(withReferences(result.cards, cues), null, 2),
			{ flag: "wx", mode: 0o600 },
		);
	}
	for (const [index, result] of cachedExtractions)
		await storeSection(index, result, true);
	await writeFile(
		join(output, "preview.json"),
		JSON.stringify(
			{
				model: MODEL,
				reasoning_effort: "low",
				max_tokens: MAX_OUTPUT_TOKENS,
				messages,
			},
			null,
			2,
		),
		{ flag: "wx", mode: 0o600 },
	);
	await saveReport();
	console.log(
		`Prepared ${cues.length} cues in ${sections.length} section(s); reusing ${reusedRequests.length} received response(s); at most ${maximumRequests} new API requests.\nOutput: ${output}`,
	);
	if (!send) {
		console.log(
			"Dry run complete. No network request or credits used. Add --send only when ready to upload this transcript.",
		);
		return output;
	}
	const cancellation = new AbortController(),
		cancel = () => cancellation.abort();
	process.once("SIGINT", cancel);
	process.once("SIGTERM", cancel);
	async function ask(
		stage: string,
		requestMessages: ReturnType<typeof extractionMessages>,
	): Promise<unknown> {
		const saved = checkpoint?.stages.get(stage);
		if (saved) return saved.content;
		if (requests.length >= maximumRequests || requests.length >= MAX_CHUNKS + 1)
			throw new Error("Trial request limit reached.");
		cancellation.signal.throwIfAborted();
		const inputCharacters = JSON.stringify(requestMessages).length;
		if (inputCharacters > MAX_INPUT_CHARACTERS)
			throw new Error("Request exceeds the trial input limit.");
		const request: RequestRecord = {
			stage,
			requestId: randomUUID(),
			status: "started",
			seconds: 0,
			inputCharacters,
			responseFile: `response-${requests.length + 1}.unvalidated.json`,
			usage: { promptTokens: null, completionTokens: null, totalTokens: null },
		};
		requests.push(request);
		await saveReport();
		console.log(`Request ${requests.length}/${maximumRequests}: ${stage}`);
		const started = performance.now();
		try {
			const signal = AbortSignal.any([
				cancellation.signal,
				AbortSignal.timeout(180_000),
			]);
			let response: Response;
			try {
				response = await fetcher(endpoint, {
					method: "POST",
					redirect: "error",
					signal,
					headers: {
						Authorization: `Bearer ${key}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						model: MODEL,
						messages: requestMessages,
						stream: false,
						thinking: { type: "enabled" },
						reasoning_effort: "low",
						temperature: 1,
						top_p: 0.95,
						response_format: { type: "json_object" },
						max_tokens: MAX_OUTPUT_TOKENS,
						request_id: request.requestId,
					}),
				});
			} catch {
				throw new Error(
					"API request was cancelled, timed out or failed to connect. It was not retried; usage may be unknown.",
				);
			}
			if (!response.ok) {
				await response.body?.cancel();
				throw new Error(
					`Z.ai returned HTTP ${response.status}. No automatic retry was made.`,
				);
			}
			const payload = record(await responseJson(response));
			const usage =
				payload.usage && typeof payload.usage === "object"
					? record(payload.usage)
					: {};
			request.usage = {
				promptTokens: counter(usage.prompt_tokens),
				completionTokens: counter(usage.completion_tokens),
				totalTokens: counter(usage.total_tokens),
			};
			request.status = "received";
			if (payload.model !== MODEL)
				throw new Error("API returned a different model than requested.");
			if (!Array.isArray(payload.choices) || payload.choices.length !== 1)
				throw new Error("API returned invalid choices.");
			const choice = record(payload.choices[0]),
				message = record(choice.message);
			if (
				choice.finish_reason !== "stop" ||
				typeof message.content !== "string"
			)
				throw new Error(
					"Model output was incomplete; no cards accepted and no retry made.",
				);
			const result: unknown = JSON.parse(message.content);
			// Model content only, never authorization headers or reasoning. Preserve
			// unvalidated data privately so a validation failure remains inspectable.
			const savedContent = JSON.stringify(result, null, 2);
			await writeFile(join(output, request.responseFile), savedContent, {
				flag: "wx",
				mode: 0o600,
			});
			request.responseSha256 = hash(Buffer.from(savedContent));
			return result;
		} catch (error) {
			request.status = "failed";
			throw error;
		} finally {
			request.seconds = Number(
				((performance.now() - started) / 1000).toFixed(2),
			);
			await saveReport();
		}
	}
	try {
		report.status = "running";
		let candidates: Card[] = [];
		for (let index = 0; index < sections.length; index++) {
			const section = sections[index],
				result =
					cachedExtractions.get(index) ??
					validateCards(
						await ask(extractionStage(index), messages[index]),
						section,
						MAX_CANDIDATES_PER_SECTION,
					);
			candidates.push(...result.cards);
			if (!cachedExtractions.has(index))
				await storeSection(index, result, false);
		}
		candidates = deduplicate(candidates);
		let selected = candidates;
		if (
			candidates.length &&
			(sections.length > 1 || candidates.length > range.max)
		) {
			const selection = selectionMessages(candidates, range, sections);
			await writeFile(
				join(output, "selection-preview.json"),
				JSON.stringify(selection, null, 2),
				{ flag: "wx", mode: 0o600 },
			);
			if (JSON.parse(selection[1].content).previewsTruncated)
				report.notes.push(
					"Selection used abbreviated question/answer previews to fit the input budget. Full cards and all citations are preserved in section files and selected output; review coverage manually.",
				);
			const result = validateSelection(
				await ask(SELECTION_STAGE, selection),
				candidates,
				range.max,
			);
			selected = result.cards;
			report.notes.push(result.notes);
		}
		report.coverage = sectionCoverage(candidates, selected, sections);
		for (const section of report.coverage) {
			if (section.available > 0 && section.selected === 0)
				report.notes.push(
					`Coverage review: section ${section.section} has ${section.available} candidate(s) but none selected. Check whether it contains a useful distinct concept; no automatic filler or retry was added.`,
				);
		}
		cancellation.signal.throwIfAborted();
		const cards = withReferences(selected, cues);
		await writeFile(
			join(output, "cards.json"),
			JSON.stringify(
				{ cards, quickReviewIds: cards.slice(0, 5).map((card) => card.id) },
				null,
				2,
			),
			{ flag: "wx", mode: 0o600 },
		);
		await writeFile(
			join(output, "review.txt"),
			reviewText(cards, report.notes),
			{ flag: "wx", mode: 0o600 },
		);
		report.status = "completed";
		await saveReport();
		console.log(
			`Saved ${cards.length} cards. Review review.txt and report.json in the output folder.\nReported total tokens for NEW requests: ${report.tokenUsage.totalTokens ?? (requests.length ? "unknown" : "none; reused responses only")}. Previously paid usage is listed separately under reusedRequests. Compare with your package dashboard; billing conversion is not inferred.`,
		);
		return output;
	} catch (error) {
		report.status = cancellation.signal.aborted ? "cancelled" : "failed";
		report.error =
			error instanceof Error && !error.message.includes(key ?? "\0")
				? error.message
				: "Trial failed; no retry was made.";
		await saveReport();
		throw new Error(
			`${report.error}\nPartial results and usage report: ${output}`,
		);
	} finally {
		process.removeListener("SIGINT", cancel);
		process.removeListener("SIGTERM", cancel);
	}
}
if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	runTrial(process.argv.slice(2)).catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : "Trial failed.");
		process.exitCode = 1;
	});
}
