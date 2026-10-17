import { expect, it } from "vitest";
import {
	positionLabel,
	shouldComplete,
	shouldSave,
	startPosition,
} from "@/features/course/trackingRules";

it("resumes only valid unfinished positions at least five seconds in and over ten seconds from the end", () => {
	expect(startPosition(5, 100, false)).toBe(5);
	expect(startPosition(89, 100, false)).toBe(89);
	for (const saved of [0, 4.99, 90, 100, 101, -1, Number.NaN, Infinity])
		expect(startPosition(saved, 100, false)).toBe(0);
	expect(startPosition(20, 100, true)).toBe(0);
	for (const duration of [0, -1, Number.NaN, Infinity])
		expect(startPosition(20, duration, false)).toBe(0);
});
it("requires actual unpaused, non-seeking playback for the 90 percent threshold, but short videos complete on ended", () => {
	expect(shouldComplete(90, 100, false, false, false)).toBe(true);
	expect(shouldComplete(89.9, 100, false, false, false)).toBe(false);
	expect(shouldComplete(90, 100, true, false, false)).toBe(false);
	expect(shouldComplete(90, 100, false, true, false)).toBe(false);
	expect(shouldComplete(27, 30, false, false, false)).toBe(false);
	expect(shouldComplete(30, 30, true, false, true)).toBe(true);
	for (const duration of [0, Number.NaN, Infinity])
		expect(shouldComplete(90, duration, false, false, true)).toBe(false);
});
it("throttles periodic writes by both five seconds and one second of position change; forced flushes bypass both", () => {
	expect(shouldSave(10, 0, 4999, 0, false)).toBe(false);
	expect(shouldSave(10, 0, 5000, 0, false)).toBe(true);
	expect(shouldSave(10.9, 10, 10000, 0, false)).toBe(false);
	expect(shouldSave(2, 10, 10000, 0, false)).toBe(true);
	expect(shouldSave(10.1, 10, 1, 0, true)).toBe(true);
	expect(shouldSave(10, 10, 10000, 0, true)).toBe(false);
	expect(shouldSave(Number.NaN, 10, 10000, 0, true)).toBe(false);
	expect(positionLabel(761.8)).toBe("12:41");
});
