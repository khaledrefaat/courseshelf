import { CSPProvider } from "@base-ui/react/csp-provider";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/App";
import "@/index.css";
import { installCloseFlush } from "@/features/course/closeProgress";
import { initializePlayback, playbackErrorMessage } from "@/lib/playback";

const closeListener = installCloseFlush().catch(() => undefined);
if (import.meta.hot)
	import.meta.hot.dispose(() => {
		void closeListener.then((unlisten) => unlisten?.());
	});

void initializePlayback()
	.then((results) => console.log("[playback registration]", results))
	.catch((error: unknown) =>
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
		</CSPProvider>
	</React.StrictMode>,
);
