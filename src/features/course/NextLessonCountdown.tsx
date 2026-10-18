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
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] bg-overlay/45 p-4">
      <div className="next-lesson-countdown flex w-full max-w-xs flex-col items-center rounded-2xl border border-border bg-card px-6 py-5 text-center text-card-foreground shadow-xl ring-1 ring-player-foreground ring-inset backdrop-blur-xl sm:py-6">
        <div
          role="status"
          aria-live="polite"
          className="flex w-full flex-col items-center"
        >
          <span className="sr-only">
            {state.flushing
              ? "Starting next lesson"
              : `Next lesson in ${state.seconds} seconds`}
          </span>
          <div
            aria-hidden="true"
            className="relative size-20 shrink-0 sm:size-24"
          >
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
                strokeWidth="4"
                className="text-border"
              />
              <circle
                cx="50"
                cy="50"
                r="44"
                fill="none"
                stroke="currentColor"
                strokeWidth="4"
                strokeLinecap="round"
                pathLength="100"
                strokeDasharray="100"
                strokeDashoffset={state.flushing ? 0 : state.seconds * 20}
                className={`next-lesson-countdown-ring text-brand ${state.flushing ? "next-lesson-countdown-ready" : ""}`}
              />
            </svg>
            <span
              key={state.seconds}
              className="absolute inset-0 flex items-center justify-center text-3xl font-semibold tabular-nums text-brand motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-90 motion-safe:duration-200"
            >
              {state.flushing ? "…" : state.seconds}
            </span>
          </div>
          <p className="mt-3 text-xs font-semibold tracking-widest text-brand uppercase">
            {state.flushing ? "Starting next lesson…" : "Up next"}
          </p>
          <p
            dir="auto"
            title={title}
            className="mt-2 line-clamp-2 w-full text-base leading-snug font-medium wrap-anywhere"
          >
            {title}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          aria-keyshortcuts="S"
          onClick={onCancel}
          className="pointer-events-auto mt-4 gap-2"
        >
          Cancel <span className="text-xs text-muted-foreground">(S)</span>
        </Button>
      </div>
    </div>
  );
}
