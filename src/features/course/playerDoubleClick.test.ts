import { expect, it, vi } from "vitest";
import { playerDoubleClick } from "@/features/course/playerDoubleClick";

function fixture() {
	const video = Object.assign(new EventTarget(), {
		controls: true,
		getBoundingClientRect: () => ({
			top: 20,
			bottom: 420,
			left: 10,
			right: 810,
		}),
	});
	const event = {
		target: video as EventTarget,
		button: 0,
		defaultPrevented: false,
		ctrlKey: false,
		altKey: false,
		metaKey: false,
		clientX: 400,
		clientY: 200,
		preventDefault: vi.fn(),
		stopImmediatePropagation: vi.fn(),
	};
	return { video, event, toggle: vi.fn() };
}

it("consumes a picture double-click and uses the existing fullscreen toggle once", () => {
	const f = fixture();
	playerDoubleClick(f.event, f.video, false, f.toggle);
	expect(f.toggle).toHaveBeenCalledOnce();
	expect(f.event.preventDefault).toHaveBeenCalledOnce();
	expect(f.event.stopImmediatePropagation).toHaveBeenCalledOnce();
	playerDoubleClick(f.event, f.video, false, f.toggle);
	expect(f.toggle).toHaveBeenCalledTimes(2); // A second double-click exits via the same controller.
});

it.each([
	"controls",
	"overlay",
	"popup",
	"modifier",
	"secondary",
	"prevented",
	"outside",
	"no-video",
])("leaves %s gestures untouched", (kind) => {
	const f = fixture();
	if (kind === "controls") f.event.clientY = 400;
	if (kind === "overlay") f.event.target = new EventTarget();
	if (kind === "modifier") f.event.ctrlKey = true;
	if (kind === "secondary") f.event.button = 2;
	if (kind === "prevented") f.event.defaultPrevented = true;
	if (kind === "outside") f.event.clientX = 900;
	playerDoubleClick(
		f.event,
		kind === "no-video" ? null : f.video,
		kind === "popup",
		f.toggle,
	);
	expect(f.toggle).not.toHaveBeenCalled();
	expect(f.event.preventDefault).not.toHaveBeenCalled();
});
