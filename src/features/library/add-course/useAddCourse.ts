import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { addCourse } from "@/features/library/add-course/addCourse";
import {
	coverBlob,
	type PickedCover,
	readCover,
} from "@/features/library/add-course/covers";
import { errorMessage } from "@/features/library/add-course/folders";
import {
	latestRequest,
	titleFromFolder,
	validationMessage,
} from "@/features/library/add-course/model";
import { nativePicker } from "@/features/library/add-course/nativePicker";
import {
	createFolderRequest,
	type previewFolder,
} from "@/features/library/add-course/previewFolder";

export function useAddCourse(onAdded: (warning: string | null) => void) {
	const [folder, setFolder] = useState("");
	const [title, setTitle] = useState("");
	const titleEdited = useRef(false);
	const [preview, setPreview] = useState<Awaited<
		ReturnType<typeof previewFolder>
	> | null>(null);
	const [scanError, setScanError] = useState<string | null>(null);
	const [scanning, setScanning] = useState(false);
	const [saving, setSaving] = useState(false);
	const savingRef = useRef(false);
	const [pickerOpen, setPickerOpen] = useState(false);
	const pickerActiveRef = useRef(false);
	const mountedRef = useRef(true);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [cover, setCover] = useState<PickedCover | null>(null);
	const [coverBusy, setCoverBusy] = useState(false);
	const [coverError, setCoverError] = useState<string | null>(null);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const requests = useRef(createFolderRequest());
	const coverRequests = useRef(latestRequest());
	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			requests.current.cancel();
			coverRequests.current.cancel();
		};
	}, []);
	useEffect(() => {
		if (!cover) {
			setPreviewUrl(null);
			return;
		}
		const url = URL.createObjectURL(coverBlob(cover));
		setPreviewUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [cover]);
	function setPickerActive(active: boolean) {
		pickerActiveRef.current = active;
		if (mountedRef.current) {
			// Commit modal=false and disable focus-out dismissal before invoking native UI.
			flushSync(() => setPickerOpen(active));
		}
	}

	async function browse() {
		if (savingRef.current || nativePicker.isBusy()) return;
		setPreview(null);
		setScanError(null);
		setSaveError(null);
		setFolder("");
		setScanning(true);
		await requests.current.run(
			async () =>
				await nativePicker.run(setPickerActive, () =>
					open({ directory: true, recursive: true, multiple: false }),
				),
			(path) => {
				setFolder(path);
				if (!titleEdited.current) setTitle(titleFromFolder(path));
			},
			(result) => {
				setPreview(result);
				setFolder(result.scan.root_path);
			},
			(cause) => setScanError(errorMessage(cause)),
			() => setScanning(false),
		);
	}
	async function chooseCover() {
		if (savingRef.current || nativePicker.isBusy()) return;
		const id = coverRequests.current.next();
		setCoverError(null);
		setCoverBusy(true);
		setSaveError(null);
		try {
			const path = await nativePicker.run(setPickerActive, () =>
				open({
					multiple: false,
					filters: [
						{ name: "Cover image", extensions: ["png", "jpg", "jpeg", "webp"] },
					],
				}),
			);
			if (!path || !coverRequests.current.isCurrent(id)) return;
			const result = await readCover(path);
			if (coverRequests.current.isCurrent(id)) setCover(result);
		} catch (cause) {
			if (coverRequests.current.isCurrent(id)) {
				setCover(null);
				setCoverError(errorMessage(cause));
			}
		} finally {
			if (coverRequests.current.isCurrent(id)) setCoverBusy(false);
		}
	}
	function removeCover() {
		coverRequests.current.cancel();
		setCover(null);
		setCoverError(null);
		setCoverBusy(false);
	}
	const message = validationMessage({
		saving,
		scanning,
		folder,
		scanError,
		duplicate: preview?.duplicate ?? false,
		lessonCount: preview?.scan.lessons.length ?? null,
		title,
		coverBusy,
		coverError,
	});
	async function submit() {
		if (
			savingRef.current ||
			nativePicker.isBusy() ||
			message !== null ||
			!preview
		)
			return;
		savingRef.current = true;
		setSaving(true);
		setSaveError(null);
		try {
			const result = await addCourse({
				root: preview.scan.root_path,
				title,
				cover,
			});
			onAdded(result.warning);
		} catch (cause) {
			setSaveError(errorMessage(cause));
		} finally {
			savingRef.current = false;
			setSaving(false);
		}
	}
	return {
		folder,
		title,
		editTitle: (value: string) => {
			titleEdited.current = true;
			setTitle(value);
			setSaveError(null);
		},
		preview,
		scanError,
		scanning,
		saving,
		savingRef,
		pickerOpen,
		pickerActiveRef,
		saveError,
		cover,
		coverBusy,
		coverError,
		previewUrl,
		browse,
		chooseCover,
		removeCover,
		rejectCover: () => {
			setCover(null);
			setCoverError(
				"The image could not be decoded. Choose a valid PNG, JPEG or WebP image.",
			);
		},
		message,
		submit,
		cancelPending: () => {
			requests.current.cancel();
			coverRequests.current.cancel();
		},
	};
}
