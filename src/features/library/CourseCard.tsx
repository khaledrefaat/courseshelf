import { Archive, ArchiveRestore, Clock3, Pencil, Trash2 } from "lucide-react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { totalTime } from "@/features/course/durations";
import { CourseCover } from "@/features/library/CourseCover";
import { courseStatus, progressPercent } from "@/features/library/model";
import type { CourseSummary } from "@/lib/db/courseSummaries";
import type { RegistrationStatus } from "@/lib/playback";

export function FolderWarning({
	registration,
}: {
	registration?: Readonly<RegistrationStatus>;
}) {
	if (!registration || registration.status === "registered") return null;
	return (
		<Badge
			variant="outline"
			title={registration.message}
			className="h-auto whitespace-normal bg-card text-xs text-muted-foreground"
		>
			{registration.status === "missing"
				? "Folder missing"
				: "Folder not authorized"}
		</Badge>
	);
}

export function CourseCard({
	course,
	registration,
	onEditCover,
	onArchive,
	onDelete,
	onLocate,
	disabled = false,
}: {
	course: CourseSummary;
	registration?: Readonly<RegistrationStatus>;
	onEditCover?: () => void;
	onArchive?: () => void;
	onDelete?: () => void;
	onLocate?: () => void;
	disabled?: boolean;
}) {
	const status = courseStatus(course);
	const percent = progressPercent(course);
	return (
		<article className="group/course-card relative overflow-hidden rounded-lg border bg-card shadow-card transition-shadow hover:shadow-md">
			<Link
				to={`/course/${course.id}`}
				className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
			>
				<CourseCover course={course} className="aspect-video">
					<Badge
						className={`absolute top-3 left-3 ${status === "Completed" ? "bg-brand text-brand-foreground" : status === "In progress" ? "bg-card/90 text-muted-foreground" : ""}`}
					>
						{status}
					</Badge>
				</CourseCover>
				<div className="space-y-2.5 p-4">
					<h2 className="truncate text-base font-semibold" title={course.title}>
						{course.title}
					</h2>
					<FolderWarning registration={registration} />
					<p
						className="flex items-center gap-1.5 text-xs text-muted-foreground"
						title={
							course.duration_seconds === null
								? "Total duration is unavailable until all lesson durations are known."
								: "Total course duration"
						}
					>
						<Clock3 aria-hidden="true" className="size-3.5 shrink-0" />
						<span className="sr-only">Total course duration: </span>
						<span>{totalTime(course.duration_seconds)}</span>
					</p>
					<div className="flex justify-between text-xs">
						<span className="text-muted-foreground">
							{course.completed_lessons} / {course.total_lessons} lessons
						</span>
						<span className="font-semibold text-brand">{percent}%</span>
					</div>
					<Progress
						value={percent}
						aria-label={`${course.title} progress`}
						className="[&_[data-slot=progress-track]]:h-1.5 [&_[data-slot=progress-track]]:bg-border"
					/>
				</div>
			</Link>
			{registration && registration.status !== "registered" && onLocate && (
				<Button
					variant="outline"
					size="sm"
					disabled={disabled}
					onClick={onLocate}
					className="mx-4 mb-4 bg-card"
				>
					Locate folder
				</Button>
			)}
			<div className="pointer-events-none absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover/course-card:pointer-events-auto group-hover/course-card:opacity-100 group-focus-within/course-card:pointer-events-auto group-focus-within/course-card:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
				{onEditCover && (
					<Button
						variant="secondary"
						size="icon"
						onClick={onEditCover}
						disabled={disabled}
						aria-label={`Edit course ${course.title}`}
						title="Edit course"
						className="size-8 bg-card/95 shadow-sm"
					>
						<Pencil aria-hidden="true" className="size-3.5" />
					</Button>
				)}
				{onArchive && (
					<Button
						variant="secondary"
						size="icon"
						onClick={onArchive}
						disabled={disabled}
						aria-label={`${course.archived_at ? "Unarchive" : "Archive"} course ${course.title}`}
						title={`${course.archived_at ? "Unarchive" : "Archive"} course`}
						className="size-8 bg-card/95 shadow-sm"
					>
						{course.archived_at ? (
							<ArchiveRestore aria-hidden="true" className="size-3.5" />
						) : (
							<Archive aria-hidden="true" className="size-3.5" />
						)}
					</Button>
				)}
				{onDelete && (
					<Button
						variant="secondary"
						size="icon"
						onClick={onDelete}
						disabled={disabled}
						aria-label={`Remove course ${course.title}`}
						title="Remove course"
						className="size-8 bg-card/95 text-destructive shadow-sm"
					>
						<Trash2 aria-hidden="true" className="size-3.5" />
					</Button>
				)}
			</div>
		</article>
	);
}
