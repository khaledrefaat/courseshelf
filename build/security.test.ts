import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const capabilities = JSON.parse(
	readFileSync("src-tauri/capabilities/default.json", "utf8"),
);

describe("release security configuration", () => {
	it("keeps scripts strict in both development and production", () => {
		for (const policy of [
			config.app.security.csp,
			config.app.security.devCsp,
		]) {
			expect(policy["script-src"]).toBe("'self'");
			expect(policy["media-src"]).toBe("http://127.0.0.1:*");
			expect(policy["default-src"]).toBe("'none'");
			expect(policy["img-src"]).toBe("'self' blob:");
		}
		expect(
			config.app.security.dangerousDisableAssetCspModification,
		).toBeUndefined();
		expect(config.app.security.assetProtocol).toBeUndefined();
	});
	it("covers the actual core call sites without broad default grants", () => {
		const permissions = capabilities.permissions.map(
			(value: string | { identifier: string }) =>
				typeof value === "string" ? value : value.identifier,
		);
		expect(
			permissions.filter((value: string) => value.startsWith("core:")),
		).toEqual([
			"core:path:allow-resolve-directory",
			"core:path:allow-join",
			"core:event:allow-listen",
			"core:event:allow-unlisten",
			"core:window:allow-destroy",
		]);
		expect(permissions).not.toContain("opener:default");
		expect(JSON.stringify(capabilities)).not.toContain("$HOME");
		expect(capabilities.windows).toEqual(["main"]);
	});
	it("preserves application identity and declares playback packages", () => {
		expect(config.identifier).toBe("com.khaled.courseshelf");
		expect(config.bundle.linux.deb.depends).toEqual([
			"gstreamer1.0-libav",
			"gstreamer1.0-plugins-base",
			"gstreamer1.0-plugins-good",
		]);
		expect(config.bundle.linux.deb.recommends).toEqual([
			"gstreamer1.0-plugins-bad",
		]);
	});
});
