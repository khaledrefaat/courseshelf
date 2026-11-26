import { expect, it, vi } from "vitest";
import { bindPlayerVolumePreference } from "@/features/course/playerVolumePreference";

const newVideo = () => Object.assign(new EventTarget(), { volume: 1 });

it("restores the last volume on a new video, including zero, without saving mute changes", () => {
	const values = new Map<string, string>();
	const storage = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: vi.fn((key: string, value: string) => values.set(key, value)),
	};
	const first = newVideo();
	const firstPreference = bindPlayerVolumePreference(first, () => storage);
	first.volume = 0.35;
	first.dispatchEvent(new Event("volumechange"));
	first.dispatchEvent(new Event("volumechange")); // Mute leaves volume unchanged.
	expect(storage.setItem).toHaveBeenCalledOnce();
	firstPreference.dispose();
	const next = newVideo();
	const nextPreference = bindPlayerVolumePreference(next, () => storage);
	expect(next.volume).toBe(0.35);
	next.dispatchEvent(new Event("volumechange")); // Queued by restoring volume.
	expect(storage.setItem).toHaveBeenCalledOnce();

	next.volume = 0.1;
	nextPreference.flush(); // The close handler can save before the media event.
	expect(storage.setItem).toHaveBeenCalledTimes(2);
	next.volume = 0;
	nextPreference.dispose();
	next.volume = 1;
	next.dispatchEvent(new Event("volumechange"));
	const reopened = newVideo();
	bindPlayerVolumePreference(reopened, () => storage).dispose();
	expect(reopened.volume).toBe(0);
});

it.each(["", "corrupt", "true", '"0.5"', "-0.1", "1.1"])(
	"keeps the default when the stored value is %j",
	(stored) => {
		const video = newVideo();
		bindPlayerVolumePreference(video, () => ({
			getItem: () => stored,
			setItem: vi.fn(),
		})).dispose();
		expect(video.volume).toBe(1);
	},
);

it("leaves the volume control usable when local storage cannot be accessed", () => {
	const video = newVideo();
	const storage = vi.fn(() => {
		throw new Error("Storage is unavailable");
	});
	const preference = bindPlayerVolumePreference(video, storage);
	expect(video.volume).toBe(1);
	video.volume = 0.25;
	video.dispatchEvent(new Event("volumechange"));
	preference.dispose();
	expect(storage).toHaveBeenCalledTimes(2);
	expect(video.volume).toBe(0.25);
});
