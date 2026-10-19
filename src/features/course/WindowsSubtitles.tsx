export function WindowsSubtitles({
	text,
	expanded,
}: {
	text: string;
	expanded: boolean;
}) {
	if (!text) return null;
	return (
		<div
			className="pointer-events-none absolute inset-x-0 bottom-16 z-10 flex justify-center px-4"
			aria-hidden="true"
		>
			<div
				dir="auto"
				className={`max-w-[80%] whitespace-pre-line break-words rounded-md bg-player/85 px-3 py-1.5 text-center font-sans font-normal leading-snug text-player-foreground ${expanded ? "text-[22px]" : "text-[18px]"}`}
			>
				{text}
			</div>
		</div>
	);
}
