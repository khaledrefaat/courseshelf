import { expect, it } from "vitest";
import { followSystemTheme } from "@/lib/systemTheme";

it("applies the initial system theme, follows changes and removes its listener", () => {
	const events = new EventTarget();
	const classes = new Set<string>();
	const preference = {
		matches: true,
		addEventListener: events.addEventListener.bind(events),
		removeEventListener: events.removeEventListener.bind(events),
	};
	const root = {
		classList: {
			toggle: (name: string, enabled?: boolean) => {
				if (enabled) classes.add(name);
				else classes.delete(name);
				return !!enabled;
			},
		},
	};
	const stop = followSystemTheme(preference, root);
	expect(classes.has("dark")).toBe(true);
	preference.matches = false;
	events.dispatchEvent(new Event("change"));
	expect(classes.has("dark")).toBe(false);
	stop();
	preference.matches = true;
	events.dispatchEvent(new Event("change"));
	expect(classes.has("dark")).toBe(false);
});
