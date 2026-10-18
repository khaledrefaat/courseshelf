export function followSystemTheme(
	preference: Pick<
		MediaQueryList,
		"matches" | "addEventListener" | "removeEventListener"
	>,
	root: { classList: Pick<DOMTokenList, "toggle"> },
): () => void {
	const update = () => root.classList.toggle("dark", preference.matches);
	update();
	preference.addEventListener("change", update);
	return () => preference.removeEventListener("change", update);
}
