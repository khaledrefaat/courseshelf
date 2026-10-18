import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { editCourse } from "@/features/course-management/actions";
import { validTitle } from "@/features/course-management/model";
import { useManagement } from "@/features/course-management/state";
import { CourseCover } from "@/features/library/CourseCover";
import { useEditCover } from "@/features/library/edit-cover/useEditCover";
import type { Course } from "@/lib/db/courses";

export function EditCoverDialog({
	course,
	onCancel,
	onSaved,
	editDetails = false,
}: {
	course: Pick<Course, "id" | "title" | "cover_path"> & Partial<Course>;
	editDetails?: boolean;
	onCancel: () => void;
	onSaved: (path: string | null, warning: string | null) => void;
}) {
	const [title, setTitle] = useState(course.title);
	const management = useManagement();
	const state = useEditCover(
		course,
		onSaved,
		editDetails
			? (cover) => editCourse(course as Course, title, cover)
			: undefined,
		editDetails && title.trim() !== course.title,
	);
	const locked = state.saving || state.pickerOpen || management.busy;
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
					<DialogTitle className="text-xl font-bold">
						{editDetails ? "Edit course" : "Edit cover"}
					</DialogTitle>
					<DialogDescription>{course.title}</DialogDescription>
				</DialogHeader>
				{editDetails && (
					<div className="space-y-2">
						<Label htmlFor="edit-course-title">Course title</Label>
						<Input
							id="edit-course-title"
							value={title}
							maxLength={120}
							disabled={locked}
							onChange={(event) => setTitle(event.target.value)}
						/>
						{!validTitle(title) && (
							<p role="alert" className="text-sm text-destructive">
								Title is required (maximum 120 characters).
							</p>
						)}
					</div>
				)}
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
							title: editDetails ? title : course.title,
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
						disabled={
							locked ||
							state.reading ||
							!state.dirty ||
							state.invalid ||
							(editDetails && !validTitle(title))
						}
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
