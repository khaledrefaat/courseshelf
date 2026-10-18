import { createServer as createHttpServer } from "node:http";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";
import { describe, expect, it } from "vitest";
import {
	cspCompatibility,
	externalizeRefresh,
	refreshPath,
	styleNonceId,
} from "./csp";

describe("development CSP", () => {
	it("serves React refresh as a same-origin module instead of inline code", () => {
		const html =
			'<script type="module">import { injectIntoGlobalHook } from "/@react-refresh"; injectIntoGlobalHook(window);</script>';
		expect(externalizeRefresh(html)).toBe(
			`<script type="module" src="${refreshPath}"></script>`,
		);
	});
	it("leaves application script tags unchanged", () => {
		const html = '<script type="module" src="/src/main.tsx"></script>';
		expect(externalizeRefresh(html)).toBe(html);
	});
	it("externalizes the real Vite React preamble after all HTML transforms", async () => {
		// An unbound HMR server exercises the real transform without opening a port.
		const httpServer = createHttpServer();
		const server = await createServer({
			configFile: false,
			plugins: [react(), cspCompatibility(react.preambleCode)],
			server: { middlewareMode: true, hmr: { server: httpServer } },
		});
		try {
			const html = await server.transformIndexHtml(
				"/",
				'<!doctype html><html><head></head><body><div id="root"></div></body></html>',
			);
			expect(html).toContain(`src="${refreshPath}"`);
			expect(html).toContain(`id="${styleNonceId}"`);
			for (const script of html.matchAll(
				/<script\b([^>]*)>([\s\S]*?)<\/script>/g,
			)) {
				expect(script[1]).toContain("src=");
				expect(script[2].trim()).toBe("");
			}
		} finally {
			await server.close();
		}
	});
});
