import { expect, it } from "vitest";
import {
	isEmptyNote,
	limitNote,
	NOTE_LIMIT,
	pasteNote,
} from "@/features/notes/model";

it("only treats whitespace-only text as empty; Arabic, mixed text and leading/trailing whitespace stay exact", () => {
	for (const value of ["", " \t\r\n", "\u00a0\u2003"])
		expect(isEmptyNote(value)).toBe(true);
	for (const value of [
		"  ملاحظاتي\n",
		"  SELECT الاسم FROM users\n\t",
		"  <b>plain text</b>  ",
	]) {
		expect(isEmptyNote(value)).toBe(false);
		expect(limitNote(value)).toBe(value);
	}
});
it("truncates pasted text while preserving the selection replacement and caret, without splitting surrogate pairs", () => {
	const text = "ا".repeat(NOTE_LIMIT - 2);
	const result = pasteNote(text, 10, 12, "hello");
	expect(result.text).toHaveLength(NOTE_LIMIT);
	expect(result.limited).toBe(true);
	expect(result.cursor).toBe(14);
	expect(pasteNote("مرحبا world", 6, 11, "SQL")).toEqual({
		text: "مرحبا SQL",
		cursor: 9,
		limited: false,
	});
	expect(pasteNote("a".repeat(NOTE_LIMIT - 1), 0, 0, "😀").text).toHaveLength(
		NOTE_LIMIT - 1,
	);
});
