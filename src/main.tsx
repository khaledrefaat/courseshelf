import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/App";
import { initializePlayback, playbackErrorMessage } from "@/lib/playback";

void initializePlayback()
	.then((results) => console.log("[playback registration]", results))
	.catch((error: unknown) =>
		console.error("[playback registration]", playbackErrorMessage(error)),
	);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
