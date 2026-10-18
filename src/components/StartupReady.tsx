import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { scheduleStartupReady } from "@/lib/startupReady";

export function StartupReady() {
	useEffect(
		() => scheduleStartupReady(() => invoke<void>("frontend_ready"), window),
		[],
	);
	return null;
}
