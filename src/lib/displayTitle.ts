// Lesson titles come straight from filenames; drop leading symbols
// ("-Intro" -> "Intro") for display only. Stored titles stay untouched.
export function displayTitle(title: string): string {
	const stripped = title.replace(/^[^\p{L}\p{N}]+/u, "").trim();
	return stripped || title;
}
