import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { CourseFlashcardStatus } from "@/features/flashcards/CourseFlashcardStatus";
import { FlashcardKeyDialog } from "@/features/flashcards/FlashcardKeyDialog";
import { FlashcardReview } from "@/features/flashcards/FlashcardReview";
import {
	cancelFlashcards,
	discardCheckpoint,
	type PreparedLesson,
	prepareFlashcards,
	refreshFlashcards,
	sessionKey,
	startFlashcards,
	useCourseFlashcards,
	useFlashcards,
} from "@/features/flashcards/service";
import { type FlashcardSet, readFlashcards } from "@/lib/db/flashcards";
import {
	canResume,
	type Preparation,
	plan,
	remainingRequests,
} from "@/lib/flashcards/pipeline";

export function FlashcardsPanel({
	courseId,
	lessonId,
	reviewRequested,
	onReview,
	onReviewClosed,
	onAvailability,
	disabled,
}: {
	courseId: number;
	lessonId: number;
	reviewRequested: number;
	onReviewClosed(): void;
	onReview(): void;
	onAvailability(count: number): void;
	disabled: boolean;
}) {
	const state = useFlashcards();
	const queue = useCourseFlashcards();
	const [set, setSet] = useState<FlashcardSet | null>(null),
		[prepared, setPrepared] = useState<PreparedLesson | null>(null);
	const [source, setSource] = useState<Preparation["source"] | null>(null);
	const [busy, setBusy] = useState(false),
		[failure, setFailure] = useState<string | null>(null);
	const [confirm, setConfirm] = useState(false),
		[keyOpen, setKeyOpen] = useState(false);
	const [review, setReview] = useState(false);
	const mounted = useRef(true),
		requested = useRef(reviewRequested);
	const own =
		state.job?.courseId === courseId && state.job.lessonId === lessonId;
	const active = !!state.job?.running || !!queue?.running;
	const generationId = set?.generationId;
	const preparedPlan = useMemo(
		() => (prepared ? plan(prepared.prepared.source) : null),
		[prepared],
	);
	const resumable = useMemo(
		() => !!prepared && canResume(prepared.prepared, prepared.identity),
		[prepared],
	);
	const stale =
		!!set &&
		!!source &&
		(set.sourceHash !== source.sourceHash ||
			set.sourceFingerprint !== source.sourceFingerprint);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	useEffect(() => {
		void state.revision;
		let current = true;
		void readFlashcards(lessonId)
			.then((saved) => {
				if (current) {
					setSet(saved);
					onAvailability(saved?.cards.length ?? 0);
				}
			})
			.catch(() => {
				if (current) setFailure("Could not load saved flashcards.");
			});
		return () => {
			current = false;
		};
	}, [lessonId, state.revision, onAvailability]);
	// Read-only source checks can fail (unmounted drive/no transcript) without
	// preventing offline review of the saved set. No network or generation here.
	useEffect(() => {
		if (!generationId) return;
		let current = true;
		void prepareFlashcards(courseId, lessonId, false)
			.then((input) => {
				if (current) setSource(input.prepared.source);
			})
			.catch(() => {});
		return () => {
			current = false;
		};
	}, [courseId, lessonId, generationId]);
	useEffect(() => {
		if (reviewRequested !== requested.current) {
			requested.current = reviewRequested;
			if (set?.cards.length) setReview(true);
		}
	}, [reviewRequested, set]);
	async function act(action: () => Promise<void>) {
		setBusy(true);
		setFailure(null);
		try {
			await action();
		} catch (cause) {
			if (mounted.current)
				setFailure(cause instanceof Error ? cause.message : String(cause));
		} finally {
			if (mounted.current) setBusy(false);
		}
	}
	async function openGeneration() {
		await act(async () => {
			const input = await prepareFlashcards(courseId, lessonId);
			if (!mounted.current) return;
			setSource(input.prepared.source);
			setPrepared(input);
			await sessionKey();
			if (mounted.current) setConfirm(true);
		});
	}
	function begin(resume: boolean) {
		if (!prepared) return;
		let complete = false;
		try {
			complete =
				resume &&
				remainingRequests(
					prepared.prepared.source,
					prepared.prepared.resume?.replies ?? [],
				) === 0;
		} catch (cause) {
			setFailure(
				cause instanceof Error ? cause.message : "Invalid checkpoint.",
			);
			setConfirm(false);
			return;
		}
		if (!state.keyReady && !complete) {
			setKeyOpen(true);
			return;
		}
		setConfirm(false);
		void startFlashcards(prepared, resume).catch((cause) => {
			if (mounted.current)
				setFailure(cause instanceof Error ? cause.message : String(cause));
		});
	}
	function closeReview() {
		setReview(false);
		onReviewClosed();
	}
	useEffect(() => {
		if (disabled) setReview(false);
	}, [disabled]);
	return (
		<section
			aria-label="Lesson flashcards"
			className="mt-6 rounded-xl border bg-card p-5 shadow-sm"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 className="font-semibold">
						Flashcards{set ? ` · ${set.cards.length}` : ""}
					</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						Recall the important ideas from this lesson. Saved cards work
						offline.
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					{set && set.cards.length > 0 && (
						<Button variant="outline" disabled={disabled} onClick={onReview}>
							Review cards
						</Button>
					)}
					<Button
						variant="outline"
						disabled={busy || active || disabled}
						onClick={() => void openGeneration()}
					>
						{busy
							? "Preparing…"
							: set
								? "Regenerate flashcards"
								: "Generate flashcards"}
					</Button>
				</div>
			</div>
			{!set && (
				<p className="mt-3 text-xs text-muted-foreground">
					Uses an existing VTT/SRT or generated subtitle transcript and your own
					Z.ai credits. No video upload.
				</p>
			)}
			{set && !set.cards.length && (
				<p className="mt-3 text-sm text-muted-foreground">
					No substantive cards were selected. Introductory or promotional
					lessons may correctly produce none.
				</p>
			)}
			{stale && (
				<p role="status" className="mt-3 text-sm text-brand">
					The transcript or video changed. These cards may be outdated; review
					remains available.
				</p>
			)}
			{set?.notes && (
				<details className="mt-3 text-sm text-muted-foreground">
					<summary className="cursor-pointer">
						Generation and coverage notes
					</summary>
					<p className="mt-2 whitespace-pre-wrap">{set.notes}</p>
				</details>
			)}
			{set && (
				<details className="mt-3 text-xs text-muted-foreground">
					<summary className="cursor-pointer">Reported API usage</summary>
					<p className="mt-2">
						New requests:{" "}
						{set.usage.newRequests.reduce(
							(total, usage) => total + (usage?.totalTokens ?? 0),
							0,
						)}{" "}
						reported tokens
						{set.usage.newRequests.some((usage) => !usage)
							? " (some usage unknown)"
							: ""}
						. Reused requests: {set.usage.reusedRequests.length}. Provider token
						counts are not a package-billing estimate.
					</p>
				</details>
			)}
			{own && state.job && (
				<p role="status" className="mt-3 text-sm text-muted-foreground">
					{state.job.stage}
				</p>
			)}
			{(failure || (own && state.job?.error)) && (
				<p role="alert" className="mt-3 text-sm text-destructive">
					{failure || state.job?.error}
				</p>
			)}
			{own && state.job?.warning && (
				<p role="status" className="mt-3 text-sm text-muted-foreground">
					{state.job.warning}
				</p>
			)}
			<Dialog open={confirm} onOpenChange={setConfirm}>
				<DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>
							{set
								? "Regenerate lesson flashcards?"
								: "Generate lesson flashcards?"}
						</DialogTitle>
						<DialogDescription>
							This uploads this lesson’s plain-text transcript to Z.ai and
							consumes your credits. No video, notes or course-folder paths are
							sent.
						</DialogDescription>
					</DialogHeader>
					{prepared && (
						<>
							<p className="break-all text-sm">
								Transcript: {prepared.prepared.source.filename}
							</p>
							<p>
								{preparedPlan?.sections.length} section(s), at most{" "}
								{preparedPlan?.maximumRequests} requests for a fresh run, each
								capped at 8,192 output tokens. Actual input usage varies.
							</p>
							<p className="text-sm text-muted-foreground">
								Cards can be wrong. AI-added context is separately labeled and
								is not independently verified. No automatic retries.
							</p>
							{set && (
								<p className="text-sm text-brand">
									A successful regeneration replaces this set, including your
									edits/deletions. Failed generation keeps the existing set.
								</p>
							)}
							{prepared.prepared.checkpointError && (
								<p className="text-sm text-destructive">
									{prepared.prepared.checkpointError}
								</p>
							)}
							{prepared.prepared.resume && (
								<p className="text-sm text-muted-foreground">
									{prepared.prepared.resume.replies.length} received response(s)
									saved.
									{!resumable &&
										" This checkpoint is outdated or has an uncertain request; automatic resume is unavailable."}{" "}
									Starting over may repeat previously paid requests. Reported
									tokens in received work:{" "}
									{prepared.prepared.resume.replies.reduce(
										(total, reply) => total + (reply.usage?.totalTokens ?? 0),
										0,
									)}
									{prepared.prepared.resume.replies.some(
										(reply) => !reply.usage,
									)
										? " (some usage unknown)"
										: ""}
									.
								</p>
							)}
							<div className="flex flex-wrap gap-2">
								{resumable && (
									<Button disabled={busy || active} onClick={() => begin(true)}>
										Resume received work
									</Button>
								)}
								<Button
									variant={prepared.prepared.resume ? "outline" : "default"}
									disabled={busy || active}
									onClick={() => begin(false)}
								>
									{prepared.prepared.resume
										? "Discard checkpoint and start over"
										: "Generate using my credits"}
								</Button>
								{(prepared.prepared.resume ||
									prepared.prepared.checkpointError) && (
									<Button
										variant="ghost"
										disabled={busy || active}
										onClick={() =>
											void act(async () => {
												await discardCheckpoint(courseId, lessonId);
												setConfirm(false);
											})
										}
									>
										Discard checkpoint only
									</Button>
								)}
							</div>
						</>
					)}
					<div className="flex flex-wrap gap-2">
						<Button variant="ghost" onClick={() => setKeyOpen(true)}>
							{state.keyReady ? "Replace session API key" : "Enter API key"}
						</Button>
						{state.keyReady && (
							<Button
								variant="ghost"
								disabled={busy}
								onClick={() =>
									void act(async () => {
										await sessionKey("");
									})
								}
							>
								Forget key
							</Button>
						)}
					</div>
					{failure && (
						<p role="alert" className="text-sm text-destructive">
							{failure}
						</p>
					)}
				</DialogContent>
			</Dialog>
			{keyOpen && <FlashcardKeyDialog onClose={() => setKeyOpen(false)} />}
			{review && set && (
				<FlashcardReview
					key={set.generationId}
					set={set}
					onClose={closeReview}
					onChanged={async () => {
						const saved = await readFlashcards(lessonId);
						if (mounted.current) {
							setSet(saved);
							onAvailability(saved?.cards.length ?? 0);
							refreshFlashcards();
						}
					}}
				/>
			)}
		</section>
	);
}

export function FlashcardJobStatus() {
	return (
		<>
			<CourseFlashcardStatus />
			<SingleFlashcardJobStatus />
		</>
	);
}
function SingleFlashcardJobStatus() {
	const { job } = useFlashcards();
	const queue = useCourseFlashcards();
	const [error, setError] = useState<string | null>(null);
	if (!job?.running || queue?.running) return null;
	return (
		<div
			role="status"
			className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-brand-soft px-5 py-2 text-sm text-brand"
		>
			<span>Flashcards · {job.stage}</span>
			<Button
				variant="ghost"
				size="sm"
				onClick={() => {
					void cancelFlashcards(job.courseId).catch(() =>
						setError("Could not cancel. Close the app to stop the job."),
					);
				}}
			>
				Cancel generation
			</Button>
			{error && <p role="alert">{error}</p>}
		</div>
	);
}
