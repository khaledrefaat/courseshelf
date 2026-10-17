import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
	coverBlob,
	type PickedCover,
	readCover,
} from "@/features/library/add-course/covers";
import { errorMessage } from "@/features/library/add-course/folders";
import { latestRequest } from "@/features/library/add-course/model";
import { nativePicker } from "@/features/library/add-course/nativePicker";
import { updateCourseCover } from "@/features/library/edit-cover/courseActions";
import type { CourseSummary } from "@/lib/db/courseSummaries";

export function useEditCover(
	course: CourseSummary,
	onSaved: (path: string | null, warning: string | null) => void,
) {
	const [change, setChange] = useState<PickedCover | null | undefined>(
		undefined,
	);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [invalid, setInvalid] = useState(false);
	const [reading, setReading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [pickerOpen, setPickerOpen] = useState(false);
	const pickerActiveRef = useRef(false);
	const savingRef = useRef(false);
	const readingRef = useRef(false);
	const mounted = useRef(true);
	const requests = useRef(latestRequest());
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			requests.current.cancel();
		};
	}, []);
	useEffect(() => {
		if (!change) {
			setPreviewUrl(null);
			return;
		}
		const url = URL.createObjectURL(coverBlob(change));
		setPreviewUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [change]);
	function setPickerActive(active: boolean) {
		pickerActiveRef.current = active;
		if (mounted.current) flushSync(() => setPickerOpen(active));
	}
	async function choose() {
		if (savingRef.current || readingRef.current || nativePicker.isBusy())
			return;
		const id = requests.current.next();
		readingRef.current = true;
		setReading(true);
		setError(null);
		setInvalid(false);
		try {
			const path = await nativePicker.run(setPickerActive, () =>
				open({
					multiple: false,
					filters: [
						{ name: "Cover image", extensions: ["png", "jpg", "jpeg", "webp"] },
					],
				}),
			);
			if (!path || !requests.current.isCurrent(id)) return;
			const cover = await readCover(path);
			if (requests.current.isCurrent(id)) setChange(cover);
		} catch (cause) {
			if (requests.current.isCurrent(id)) {
				setChange(undefined);
				setInvalid(true);
				setError(errorMessage(cause));
			}
		} finally {
			readingRef.current = false;
			if (mounted.current) setReading(false);
		}
	}
	const dirty =
		change !== undefined && (change !== null || course.cover_path !== null);
	async function save() {
		if (
			!dirty ||
			invalid ||
			savingRef.current ||
			readingRef.current ||
			nativePicker.isBusy()
		)
			return;
		savingRef.current = true;
		setSaving(true);
		setError(null);
		try {
			const result = await updateCourseCover(
				course.id,
				course.cover_path,
				change ?? null,
			);
			if (mounted.current) onSaved(result.path, result.warning);
		} catch (cause) {
			if (mounted.current) setError(errorMessage(cause));
		} finally {
			savingRef.current = false;
			if (mounted.current) setSaving(false);
		}
	}
	return {
		change,
		previewUrl,
		error,
		invalid,
		reading,
		saving,
		pickerOpen,
		pickerActiveRef,
		savingRef,
		dirty,
		choose,
		save,
		remove: () => {
			requests.current.cancel();
			setChange(null);
			setError(null);
			setInvalid(false);
		},
		reject: () => {
			setChange(undefined);
			setInvalid(true);
			setError(
				"The image could not be decoded. Choose a valid PNG, JPEG or WebP image.",
			);
		},
	};
}
