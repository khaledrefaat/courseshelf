const VOLUME_PREFERENCE = "courseshelf:player-volume";

export function bindPlayerVolumePreference(
	video: Pick<
		HTMLVideoElement,
		"volume" | "addEventListener" | "removeEventListener"
	>,
	storage: () => Pick<Storage, "getItem" | "setItem"> = () =>
		window.localStorage,
) {
	try {
		const stored = storage().getItem(VOLUME_PREFERENCE);
		const volume: unknown = stored === null ? null : JSON.parse(stored);
		if (typeof volume === "number" && volume >= 0 && volume <= 1)
			video.volume = volume;
	} catch {
		// An invalid or unavailable preference leaves the video's default volume.
	}

	let lastVolume = video.volume;
	const save = () => {
		const volume = video.volume;
		// Restoration and mute/unmute can also dispatch volumechange.
		if (volume === lastVolume) return;
		lastVolume = volume;
		try {
			storage().setItem(VOLUME_PREFERENCE, String(volume));
		} catch {
			// Volume controls still work when local storage is unavailable.
		}
	};
	video.addEventListener("volumechange", save);
	return {
		flush: save,
		dispose() {
			video.removeEventListener("volumechange", save);
			save(); // Catch a last change whose media event is still queued.
		},
	};
}
