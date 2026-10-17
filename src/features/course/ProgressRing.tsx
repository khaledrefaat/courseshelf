export function ProgressRing({
	percent,
	completed,
	total,
}: {
	percent: number;
	completed: number;
	total: number;
}) {
	const circumference = 2 * Math.PI * 26;
	return (
		<div className="relative size-16 shrink-0">
			<svg
				viewBox="0 0 64 64"
				role="progressbar"
				aria-label={`Course completion: ${completed} of ${total} lessons`}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={percent}
				className="size-full -rotate-90"
			>
				<circle
					cx="32"
					cy="32"
					r="26"
					fill="none"
					stroke="var(--border)"
					strokeWidth="6"
				/>
				<circle
					cx="32"
					cy="32"
					r="26"
					fill="none"
					stroke="var(--brand)"
					strokeWidth="6"
					strokeLinecap={percent ? "round" : "butt"}
					strokeDasharray={circumference}
					strokeDashoffset={circumference * (1 - percent / 100)}
				/>
			</svg>
			<span
				aria-hidden="true"
				className="absolute inset-0 flex items-center justify-center text-sm font-bold"
			>
				{percent}%
			</span>
		</div>
	);
}
