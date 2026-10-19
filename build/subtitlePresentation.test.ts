import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("preserves Linux native sizing without obsolete WebView2 cue CSS overrides", () => {
	const css = readFileSync(
		new URL("../src/index.css", import.meta.url),
		"utf8",
	).replace(/\/\*[\s\S]*?\*\//g, "");
	expect(css).toMatch(
		/\.lesson-video::cue\s*\{\s*font-size: clamp\(16px, 1\.6vw, 28px\);\s*\}/,
	);
	expect([...css.matchAll(/::cue\s*\{/g)]).toHaveLength(1);
});
