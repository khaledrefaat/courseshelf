import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { removeCourse } from "@/features/course-management/actions";
import { errorMessage } from "@/features/library/add-course/folders";
import { type Course, removalCounts } from "@/lib/db/courses";

export function DeleteCourseDialog({
	course,
	onCancel,
	onDeleted,
}: {
	course: Pick<Course, "id" | "title">;
	onCancel: () => void;
	onDeleted: (warning: string | null) => void;
}) {
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const busy = useRef(false);
	const [counts, setCounts] = useState<{
		lessons: number;
		notes: number;
	} | null>(null);
	useEffect(() => {
		let active = true;
		void removalCounts(course.id)
			.then((value) => {
				if (active) setCounts(value);
			})
			.catch((cause) => {
				if (active) setError(errorMessage(cause));
			});
		return () => {
			active = false;
		};
	}, [course.id]);
	async function confirm() {
		if (busy.current) return;
		busy.current = true;
		setSaving(true);
		setError(null);
		try {
			const warning = await removeCourse(course.id);
			onDeleted(warning);
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			busy.current = false;
			setSaving(false);
		}
	}
	return (
		<Dialog
			open
			onOpenChange={(open, details) => {
				if (!open) {
					if (busy.current) {
						details.cancel();
						return;
					}
					onCancel();
				}
			}}
		>
			<DialogContent showCloseButton={false} className="p-6 sm:max-w-120">
				<DialogHeader>
					<DialogTitle className="text-xl font-bold">
						Remove course?
					</DialogTitle>
					<DialogDescription>
						Remove “{course.title}” from your library?
					</DialogDescription>
				</DialogHeader>
				<p className="text-sm text-muted-foreground">
					This permanently deletes its lessons, progress and notes from
					Courseshelf. Your video folder and original images stay untouched.
					This cannot be undone.
				</p>
				<p className="text-sm">
					{counts
						? `${counts.lessons} lessons and ${counts.notes} notes will be deleted (including missing lessons). Unsaved drafts will be discarded.`
						: "Loading deletion counts…"}
				</p>
				{error && (
					<p role="alert" className="text-sm text-destructive">
						{error}
					</p>
				)}
				<div className="mt-2 flex justify-end gap-3">
					<Button
						variant="outline"
						disabled={saving}
						onClick={onCancel}
						className="h-10 bg-card px-4"
					>
						Cancel
					</Button>
					<Button
						variant="destructive"
						disabled={saving || !counts}
						onClick={() => void confirm()}
						className="h-10 gap-2 bg-destructive px-4 text-primary-foreground hover:bg-destructive/90"
					>
						{saving && (
							<LoaderCircle
								aria-hidden="true"
								className="size-4 animate-spin"
							/>
						)}
						{saving ? "Removing…" : "Remove course"}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
