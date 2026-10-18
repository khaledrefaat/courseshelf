import { describe, expect, it } from "vitest";
import { displayTitle } from "@/lib/displayTitle";

describe("displayTitle", () => {
	it.each([
		["-Introduction-to-the-course", "Introduction-to-the-course"],
		["_..Getting started", "Getting started"],
		["  -- Intro", "Intro"],
		["~# Intro", "Intro"],
		["01 - Intro", "01 - Intro"],
		["Introduction - part 2", "Introduction - part 2"],
		["-مقدمة", "مقدمة"],
		["!!!", "!!!"],
	])("%s -> %s", (title, expected) => {
		expect(displayTitle(title)).toBe(expected);
	});
});
