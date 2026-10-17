import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/App";

if (import.meta.env.DEV) {
	void import("@/lib/db/devCheck")
		.then(({ runDevCheck }) => runDevCheck())
		.catch((error: unknown) => console.error("[db dev check] FAIL", error));
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
