import type { Plugin } from "vite";

export const styleNonceId = "courseshelf-style-nonce";
export const refreshPath = "/@courseshelf/react-refresh";

// React refresh normally injects an inline module. Keep script-src strict in dev too.
export function externalizeRefresh(html: string): string {
	return html.replace(
		/<script\b[^>]*>([\s\S]*?)<\/script>/g,
		(tag, code: string) =>
			code.includes("injectIntoGlobalHook") && code.includes("/@react-refresh")
				? `<script type="module" src="${refreshPath}"></script>`
				: tag,
	);
}

export function cspCompatibility(refreshPreamble: string): Plugin {
	return {
		name: "courseshelf-csp",
		enforce: "post",
		configureServer(server) {
			server.middlewares.use(refreshPath, (_request, response) => {
				response.setHeader("Content-Type", "text/javascript");
				response.end(refreshPreamble.replace("__BASE__", "/"));
			});
		},
		transformIndexHtml: {
			order: "post",
			handler(html) {
				return {
					html: externalizeRefresh(html),
					tags: [
						{
							tag: "style",
							attrs: { id: styleNonceId },
							// Insert after Vite's CSS extraction. Tauri assigns a runtime nonce.
							children: "/* Nonce anchor for Base UI runtime styles. */",
							injectTo: "head",
						},
					],
				};
			},
		},
	};
}
