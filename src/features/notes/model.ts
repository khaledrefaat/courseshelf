export const NOTE_LIMIT = 50_000;
export function isEmptyNote(content: string): boolean {
	return content.trim().length === 0;
}

// Preserve content exactly. Avoid splitting an astral character at the boundary.
export function limitNote(content: string, maximum = NOTE_LIMIT): string {
	let end = Math.min(content.length, maximum);
	if (end < content.length && /[\uD800-\uDBFF]/u.test(content[end - 1] ?? ""))
		end--;
	return content.slice(0, end);
}
export function pasteNote(
	text: string,
	start: number,
	end: number,
	pasted: string,
) {
	const available = NOTE_LIMIT - (text.length - (end - start));
	const inserted = limitNote(pasted, Math.max(0, available));
	return {
		text: text.slice(0, start) + inserted + text.slice(end),
		cursor: start + inserted.length,
		limited: inserted.length < pasted.length,
	};
}
