import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	previewRelocation,
	relocate,
} from "@/features/course-management/actions";
import { manage, useManagement } from "@/features/course-management/state";
import { errorMessage } from "@/features/library/add-course/folders";
import { nativePicker } from "@/features/library/add-course/nativePicker";
import type { Course } from "@/lib/db/courses";

export function LocateDialog({
	course,
	onCancel,
	onDone,
}: {
	course: Course;
	onCancel: () => void;
	onDone: () => void;
}) {
	const [preview, setPreview] = useState<Awaited<
		ReturnType<typeof previewRelocation>
	> | null>(null);
	const [error, setError] = useState("");
	const [picker, setPicker] = useState(false);
	const { busy } = useManagement();
	const request = useRef(0);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			request.current++;
		};
	}, []);
	async function browse() {
		const id = ++request.current;
		setPreview(null);
		setError("");
		try {
			const path = await nativePicker.run(
				(value) => {
					if (mounted.current) flushSync(() => setPicker(value));
				},
				() => open({ directory: true, recursive: true, multiple: false }),
			);
			if (!path || id !== request.current || !mounted.current) return;
			const result = await manage(() => previewRelocation(course.id, path));
			if (mounted.current && id === request.current) setPreview(result);
		} catch (cause) {
			if (mounted.current && id === request.current)
				setError(errorMessage(cause));
		}
	}
	async function confirm() {
		if (!preview || preview.error) return;
		try {
			await relocate(course, preview.scan.root_path);
			onDone();
		} catch (cause) {
			if (mounted.current) setError(errorMessage(cause));
		}
	}
	return (
		<Dialog
			open
			modal={!picker}
			disablePointerDismissal={picker}
			onOpenChange={(value, details) => {
				if (!value) {
					if (busy || picker) details.cancel();
					else onCancel();
				}
			}}
		>
			<DialogContent showCloseButton={false} className="p-6 sm:max-w-120">
				<DialogHeader>
					<DialogTitle>Locate folder</DialogTitle>
					<DialogDescription>
						Choose the folder containing “{course.title}”. Video files stay
						where they are.
					</DialogDescription>
				</DialogHeader>
				<p className="break-all text-xs text-muted-foreground">
					Current: {course.root_path}
				</p>
				<Button
					variant="outline"
					disabled={busy || picker}
					onClick={() => void browse()}
				>
					{busy ? "Scanning…" : "Browse"}
				</Button>
				{preview && (
					<div className="rounded-lg bg-brand-soft p-3 text-sm">
						<p className="break-all">{preview.scan.root_path}</p>
						<p>
							Matched {preview.matched} of {preview.total} lessons;{" "}
							{preview.added} new files
						</p>
					</div>
				)}
				{(error || preview?.error) && (
					<p role="alert" className="text-sm text-destructive">
						{error || preview?.error}
					</p>
				)}
				<div className="flex justify-end gap-3">
					<Button
						variant="outline"
						disabled={busy || picker}
						onClick={onCancel}
					>
						Cancel
					</Button>
					<Button
						disabled={busy || picker || !preview || !!preview.error}
						onClick={() => void confirm()}
					>
						Use this folder
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
