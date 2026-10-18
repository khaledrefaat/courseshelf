import { LoaderCircle, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AutoAdvanceState } from "@/features/course/autoAdvance";
import "@/features/course/nextLessonCountdown.css";

export function NextLessonCountdown({
	state,
	title,
	onCancel,
}: {
	state: NonNullable<AutoAdvanceState>;
	title: string;
	onCancel(): void;
}) {
	return (
		<div className="pointer-events-none absolute inset-0 z-20 flex items-start justify-end p-3">
			<div
				role="status"
				aria-live="polite"
				className="next-lesson-countdown pointer-events-auto flex max-w-[24rem] items-center gap-3 rounded-full border border-countdown-foreground/10 bg-countdown py-1.5 pr-3 pl-3 text-countdown-foreground shadow-xl dark:backdrop-blur-xl"
			>
				<span className="sr-only">
					{state.flushing
						? "Starting next lesson"
						: `Next lesson in ${state.seconds} seconds`}
				</span>
				<div aria-hidden="true" className="relative size-10 shrink-0">
					<svg
						viewBox="0 0 100 100"
						className="size-full -rotate-90"
						aria-hidden="true"
					>
						<circle
							cx="50"
							cy="50"
							r="44"
							fill="none"
							stroke="currentColor"
							strokeWidth="8"
							className="text-countdown-foreground/25"
						/>
						<circle
							cx="50"
							cy="50"
							r="44"
							fill="none"
							stroke="currentColor"
							strokeWidth="8"
							strokeLinecap="round"
							pathLength="100"
							strokeDasharray="100"
							strokeDashoffset={state.flushing ? 0 : state.seconds * 20}
							className={`next-lesson-countdown-ring text-countdown-brand ${state.flushing ? "next-lesson-countdown-ready" : ""}`}
						/>
					</svg>
					{state.flushing ? (
						<LoaderCircle className="absolute inset-0 m-auto size-4 animate-spin text-countdown-brand" />
					) : (
						<span
							key={state.seconds}
							className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums text-countdown-brand motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-90 motion-safe:duration-200"
						>
							{state.seconds}
						</span>
					)}
				</div>
				<div className="min-w-0">
					<p className="text-xs font-semibold tracking-widest text-countdown-brand uppercase">
						{state.flushing ? "Starting…" : "Up next"}
					</p>
					<p dir="auto" title={title} className="truncate text-sm font-medium">
						{title}
					</p>
				</div>
				<div
					aria-hidden="true"
					className="h-8 w-px shrink-0 bg-countdown-foreground/20"
				/>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Cancel"
					aria-keyshortcuts="S"
					title="Cancel (S)"
					onClick={onCancel}
					className="text-countdown-foreground/70 hover:bg-countdown-foreground/10 hover:text-countdown-foreground dark:hover:bg-countdown-foreground/10"
				>
					<XIcon />
				</Button>
			</div>
		</div>
	);
}
