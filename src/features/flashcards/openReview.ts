// Cancel synchronously, including a countdown already waiting for progress saves.
// Opening a review never calls play/pause/seek or changes completion.
export async function openFlashcardReview(options: {
	cancel(): unknown;
	exitFullscreen(): Promise<void>;
	current(): boolean;
	open(): void;
}) {
	options.cancel();
	await options.exitFullscreen();
	if (options.current()) options.open();
}
