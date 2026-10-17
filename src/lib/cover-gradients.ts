const palette = [
	["#d5eff2", "#a7d3dc"],
	["#dfe6ff", "#bdc9fa"],
	["#ddf2e5", "#b1dec7"],
	["#e9ddf6", "#ccb5ec"],
	["#fce5d0", "#f4c9a8"],
	["#e3e5fb", "#bfc4ef"],
	["#f9dfe9", "#edb5cd"],
	["#f5f0ce", "#e2dd9b"],
];

export function coverGradient(id: number): string {
	const colors =
		palette[(((id - 1) % palette.length) + palette.length) % palette.length];
	return `linear-gradient(120deg, ${colors[0]}, ${colors[1]})`;
}

export function coverLabel(title: string): string {
	return Array.from(title.trim().split(/\s+/)[0] || "Course")
		.slice(0, 6)
		.join("");
}
