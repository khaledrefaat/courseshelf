import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { CourseCover } from "@/features/library/CourseCover";
import { useEditCover } from "@/features/library/edit-cover/useEditCover";
import type { CourseSummary } from "@/lib/db/courseSummaries";

export function EditCoverDialog({
	course,
	onCancel,
	onSaved,
}: {
	course: CourseSummary;
	onCancel: () => void;
	onSaved: (path: string | null, warning: string | null) => void;
}) {
	const state = useEditCover(course, onSaved);
	const locked = state.saving || state.pickerOpen;
	return (
		<Dialog
			open
			modal={!state.pickerOpen}
			disablePointerDismissal={state.pickerOpen}
			onOpenChange={(open, details) => {
				if (!open) {
					if (state.savingRef.current || state.pickerActiveRef.current) {
						details.cancel();
						return;
					}
					onCancel();
				}
			}}
		>
			<DialogContent
				showCloseButton={false}
				className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 sm:max-w-120"
			>
				<DialogHeader>
					<DialogTitle className="text-xl font-bold">Edit cover</DialogTitle>
					<DialogDescription>{course.title}</DialogDescription>
				</DialogHeader>
				{state.previewUrl ? (
					<img
						src={state.previewUrl}
						alt="New course cover preview"
						onError={state.reject}
						className="aspect-video w-full rounded-lg object-cover"
					/>
				) : (
					<CourseCover
						course={{
							...course,
							cover_path: state.change === null ? null : course.cover_path,
						}}
						className="aspect-video rounded-lg"
					/>
				)}
				<p className="text-xs text-muted-foreground">
					PNG, JPEG or WebP · Up to 10 MB. The image is copied into Courseshelf;
					the original stays untouched.
				</p>
				{state.change === null && course.cover_path && (
					<p role="status" className="text-sm text-muted-foreground">
						The cover will be removed when you save.
					</p>
				)}
				<div className="flex gap-3">
					<Button
						type="button"
						variant="outline"
						disabled={locked || state.reading}
						onClick={() => void state.choose()}
						className="h-10 gap-2 bg-card px-4"
					>
						{state.reading && (
							<LoaderCircle
								aria-hidden="true"
								className="size-4 animate-spin"
							/>
						)}
						Choose image
					</Button>
					<Button
						type="button"
						variant="ghost"
						disabled={
							locked || state.reading || (!course.cover_path && !state.change)
						}
						onClick={state.remove}
						className="h-10"
					>
						Remove cover
					</Button>
				</div>
				{state.error && (
					<p role="alert" className="text-sm text-destructive">
						{state.error}
					</p>
				)}
				<div className="mt-2 flex justify-end gap-3">
					<Button
						variant="outline"
						disabled={locked}
						onClick={onCancel}
						className="h-10 bg-card px-4"
					>
						Cancel
					</Button>
					<Button
						disabled={locked || state.reading || !state.dirty || state.invalid}
						onClick={() => void state.save()}
						className="h-10 gap-2 px-4"
					>
						{state.saving && (
							<LoaderCircle
								aria-hidden="true"
								className="size-4 animate-spin"
							/>
						)}
						{state.saving ? "Saving…" : "Save changes"}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
