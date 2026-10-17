import { Check, LoaderCircle } from "lucide-react";
import { useId } from "react";
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
import { formatIgnored } from "@/features/library/add-course/model";
import { useAddCourse } from "@/features/library/add-course/useAddCourse";
import { coverGradient, coverLabel } from "@/lib/cover-gradients";

export function AddCourseDialog({
	onCancel,
	onAdded,
}: {
	onCancel: () => void;
	onAdded: (warning: string | null) => void;
}) {
	const state = useAddCourse(onAdded);
	const id = useId();
	const scan = state.preview?.scan;
	const error =
		state.saveError ??
		state.scanError ??
		(state.folder && !state.scanning ? state.message : state.coverError);
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
					state.cancelPending();
					onCancel();
				}
			}}
		>
			<DialogContent
				showCloseButton={false}
				className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl p-6 sm:max-w-170 sm:p-8"
			>
				<DialogHeader>
					<DialogTitle className="text-2xl font-bold leading-tight">
						Add course
					</DialogTitle>
					<DialogDescription>
						Pick the folder with your videos. Files stay where they are.
					</DialogDescription>
				</DialogHeader>
				<form
					className="mt-2 space-y-6"
					onSubmit={(event) => {
						event.preventDefault();
						void state.submit();
					}}
				>
					<div className="space-y-2">
						<Label htmlFor={`${id}-folder`} className="text-xs">
							Course folder
						</Label>
						<div className="flex gap-2.5">
							<Input
								id={`${id}-folder`}
								readOnly
								value={state.folder}
								placeholder="Choose a folder"
								className="h-11"
								aria-describedby={`${id}-feedback`}
							/>
							<Button
								type="button"
								variant="outline"
								disabled={state.saving || state.pickerOpen}
								className="h-11 bg-card px-5"
								onClick={() => void state.browse()}
							>
								Browse
							</Button>
						</div>
					</div>
					<div className="space-y-2">
						<Label htmlFor={`${id}-title`} className="text-xs">
							Course title
						</Label>
						<Input
							id={`${id}-title`}
							value={state.title}
							disabled={state.saving || state.pickerOpen}
							required
							maxLength={120}
							onChange={(event) => state.editTitle(event.target.value)}
							className="h-11"
						/>
						<p className="text-xs text-muted-foreground">
							Filled from the folder name. Edit anytime.
						</p>
					</div>
					<div className="space-y-2">
						<Label htmlFor={`${id}-cover`} className="text-xs">
							Cover image
						</Label>
						<div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
							<button
								id={`${id}-cover`}
								type="button"
								disabled={state.saving || state.coverBusy || state.pickerOpen}
								onClick={() => void state.chooseCover()}
								className="flex min-h-28 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-brand/30 p-3 text-center outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
							>
								<span className="text-sm font-semibold">
									{state.coverBusy ? "Checking image…" : "Choose a cover image"}
								</span>
								<span className="text-xs text-muted-foreground">
									<span className="text-brand">Choose a file</span> · PNG, JPEG,
									WebP · Up to 10 MB
								</span>
							</button>
							<div
								className="relative min-h-28 overflow-hidden rounded-lg"
								style={{ background: coverGradient(1) }}
							>
								{state.previewUrl ? (
									<img
										src={state.previewUrl}
										alt="Selected course cover"
										onError={state.rejectCover}
										className="absolute size-full object-cover"
									/>
								) : (
									<span className="absolute bottom-2 left-2.5 text-sm font-bold text-foreground/35">
										{coverLabel(state.title || "Preview")}
									</span>
								)}
							</div>
						</div>
						{(state.cover || state.coverError) && (
							<Button
								type="button"
								variant="link"
								disabled={state.saving || state.pickerOpen}
								className="h-auto p-0 text-xs text-brand"
								onClick={state.removeCover}
							>
								Remove
							</Button>
						)}
					</div>
					{state.scanning ? (
						<div
							role="status"
							className="flex items-center gap-3 rounded-lg bg-brand-soft p-3.5"
						>
							<LoaderCircle className="size-5 animate-spin text-brand" />
							Scanning folder…
						</div>
					) : (
						scan && (
							<div
								className="space-y-2 rounded-lg bg-brand-soft p-3.5"
								role="status"
							>
								<p className="flex items-center gap-3">
									<Check
										aria-hidden="true"
										className="size-5 rounded-full bg-brand p-0.5 text-brand-foreground"
									/>
									<span>
										Detected{" "}
										<strong>
											{scan.sections.length} sections, {scan.lessons.length}{" "}
											lessons
										</strong>
									</span>
								</p>
								{formatIgnored(scan.ignored_by_extension).map((message) => (
									<p key={message} className="text-xs text-muted-foreground">
										{message}
									</p>
								))}
								{scan.skipped_symlink_count > 0 && (
									<p className="text-xs text-muted-foreground">
										{scan.skipped_symlink_count} symlinks skipped.
									</p>
								)}
							</div>
						)
					)}
					<div id={`${id}-feedback`}>
						{error && !state.saving && !state.scanning && (
							<p className="text-sm text-destructive" role="alert">
								{error}
							</p>
						)}
					</div>
					<div className="flex justify-end gap-3">
						<Button
							type="button"
							variant="outline"
							disabled={state.saving || state.pickerOpen}
							className="h-11 bg-card px-5"
							onClick={() => {
								state.cancelPending();
								onCancel();
							}}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							disabled={state.message !== null || state.pickerOpen}
							className="h-11 gap-2 px-5"
						>
							{state.saving && (
								<LoaderCircle
									aria-hidden="true"
									className="size-4 animate-spin"
								/>
							)}
							{state.saving ? "Adding course…" : "Add course"}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
