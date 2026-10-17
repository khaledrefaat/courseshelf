// A task boundary lets Base UI release its focus/interaction locks before GTK opens.
// Don't use requestAnimationFrame here: it may pause when the app loses focus.
const settleModal = () =>
	new Promise<void>((resolve) => setTimeout(resolve, 0));

export function createNativePickerGate(
	settle: () => Promise<void> = settleModal,
) {
	let busy = false;
	return {
		isBusy: () => busy,
		async run<T>(
			setActive: (active: boolean) => void,
			pick: () => Promise<T>,
		): Promise<T> {
			if (busy) throw new Error("A native file picker is already open.");
			busy = true;
			try {
				setActive(true);
				await settle();
				return await pick();
			} finally {
				try {
					// Give the native window a task to close before restoring the web modal.
					await settle();
				} finally {
					try {
						setActive(false);
					} finally {
						busy = false;
					}
				}
			}
		},
	};
}

// Shared by both picker buttons, including across Add course dialog instances.
export const nativePicker = createNativePickerGate();
