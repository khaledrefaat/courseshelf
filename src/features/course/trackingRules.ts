export function startPosition(
	saved: number,
	duration: number,
	completed: boolean,
): number {
	return !completed &&
		Number.isFinite(saved) &&
		saved >= 5 &&
		Number.isFinite(duration) &&
		duration > 0 &&
		saved < duration - 10
		? saved
		: 0;
}

export function shouldComplete(
	position: number,
	duration: number,
	paused: boolean,
	seeking: boolean,
	ended: boolean,
): boolean {
	if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position))
		return false;
	return (
		ended ||
		(duration > 30 && !paused && !seeking && position >= duration * 0.9)
	);
}

export function shouldSave(
	position: number,
	previous: number,
	now: number,
	lastSave: number,
	immediate: boolean,
): boolean {
	return (
		Number.isFinite(position) &&
		position >= 0 &&
		(immediate
			? position !== previous
			: now - lastSave >= 5000 && Math.abs(position - previous) >= 1)
	);
}

export function positionLabel(seconds: number): string {
	const whole = Math.floor(seconds);
	return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
