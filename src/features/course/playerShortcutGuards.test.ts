import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	hasPlayerBlockingPopup,
	shortcutGuard,
} from "@/features/course/usePlayerControls";

// Minimal ancestry/visibility double; no DOM emulator dependency is needed.
class GuardElement extends EventTarget {
	constructor(
		readonly tag = "span",
		readonly role = "",
		readonly parent: GuardElement | null = null,
		readonly editable = false,
		readonly hidden = false,
		readonly visible = true,
	) {
		super();
	}
	closest(selector: string): GuardElement | null {
		for (let node: GuardElement | null = this; node; node = node.parent) {
			if (
				selector.split(",").some((part) => {
					const value = part.trim();
					return (
						value === node?.tag ||
						(node?.role && value === `[role="${node.role}"]`) ||
						(value.startsWith("[contenteditable]") && node?.editable) ||
						(value === "[hidden]" && node?.hidden)
					);
				})
			)
				return node;
		}
		return null;
	}
	getClientRects() {
		return this.visible ? [{}] : [];
	}
}
beforeEach(() => vi.stubGlobal("Element", GuardElement));
afterEach(() => vi.unstubAllGlobals());

it.each(["input", "textarea", "select"])("blocks %s focus", (tag) => {
	expect(shortcutGuard([new GuardElement(tag)], false).blocked).toBe(true);
});
it.each(["tab", "menu", "listbox"])(
	"blocks a descendant of role=%s",
	(role) => {
		expect(
			shortcutGuard(
				[new GuardElement("span", "", new GuardElement("div", role))],
				false,
			).blocked,
		).toBe(true);
	},
);
it("blocks inherited contenteditable including Arabic/IME editor focus", () => {
	const editor = new GuardElement("div", "", null, true);
	expect(
		shortcutGuard([new GuardElement("span", "", editor)], false).blocked,
	).toBe(true);
});
it.each(["button", "a"])(
	"preserves Space activation on %s and its children",
	(tag) => {
		expect(
			shortcutGuard(
				[new GuardElement("span", "", new GuardElement(tag))],
				false,
			),
		).toEqual({ blocked: false, activationTarget: true });
	},
);
it("blocks an open menu/dialog anywhere, not merely the focused element", () => {
	for (const role of ["dialog", "alertdialog", "menu", "listbox"]) {
		const doc = {
			querySelectorAll: () => [new GuardElement("div", role)],
		} as unknown as Document;
		expect(hasPlayerBlockingPopup(doc)).toBe(true);
		expect(
			shortcutGuard([new GuardElement("video")], hasPlayerBlockingPopup(doc))
				.blocked,
		).toBe(true);
	}
});
it("ignores retained-but-hidden popups and otherwise permits the player", () => {
	const doc = {
		querySelectorAll: () => [
			new GuardElement("div", "menu", null, false, true),
			new GuardElement("div", "dialog", null, false, false, false),
		],
	} as unknown as Document;
	expect(hasPlayerBlockingPopup(doc)).toBe(false);
	expect(shortcutGuard([new GuardElement("video")], false)).toEqual({
		blocked: false,
		activationTarget: false,
	});
});
