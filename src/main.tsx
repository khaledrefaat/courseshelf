import { CSPProvider } from "@base-ui/react/csp-provider";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/App";
import { StartupReady } from "@/components/StartupReady";
import "@/index.css";
import { installCloseFlush } from "@/features/course/closeProgress";
import { initializePlayback, playbackErrorMessage } from "@/lib/playback";
import { followSystemTheme } from "@/lib/systemTheme";

const stopTheme = followSystemTheme(
	window.matchMedia("(prefers-color-scheme: dark)"),
	document.documentElement,
);
if (import.meta.hot) import.meta.hot.dispose(stopTheme);

const closeListener = installCloseFlush().catch(() => undefined);
if (import.meta.hot)
	import.meta.hot.dispose(() => {
		void closeListener.then((unlisten) => unlisten?.());
	});

void initializePlayback().catch((error: unknown) =>
	console.error("[playback registration]", playbackErrorMessage(error)),
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<CSPProvider
			nonce={
				document.querySelector<HTMLStyleElement>("#courseshelf-style-nonce")
					?.nonce || undefined
			}
		>
			<App />
			<StartupReady />
		</CSPProvider>
	</React.StrictMode>,
);
