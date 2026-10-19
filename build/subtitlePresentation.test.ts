import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("preserves Linux sizing and scopes normal/fullscreen caption overrides to Windows", () => {
	const css = readFileSync(
		new URL("../src/index.css", import.meta.url),
		"utf8",
	).replace(/\/\*[\s\S]*?\*\//g, "");
	expect(css).toMatch(
		/\.lesson-video::cue\s*\{\s*font-size: clamp\(16px, 1\.6vw, 28px\);\s*\}/,
	);
	const overrides = [...css.matchAll(/([^{}]+)::cue\s*\{([^{}]+)\}/g)].slice(1);
	expect(overrides).toHaveLength(2);
	for (const [, selectors] of overrides) {
		for (const selector of selectors.split(","))
			expect(selector).toContain('[data-subtitle-platform="windows"]');
	}
	expect(overrides[0][2]).toContain("font-size: 20px;");
	expect(overrides[1][2]).toContain("font-size: 24px;");
	expect(overrides[1][1]).toContain('[data-subtitle-fullscreen="true"]');
	expect(overrides[1][1]).toContain("]:fullscreen");
	expect(overrides[1][1]).toContain(":fullscreen .lesson-video");
});
