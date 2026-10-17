import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
}: {
	course: CourseSummary;
	registration?: Readonly<RegistrationStatus>;
}) {
	const status = courseStatus(course);
	const percent = progressPercent(course);
	return (
		<Link
			to={`/course/${course.id}`}
			className="overflow-hidden rounded-lg border bg-card shadow-card outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
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
	);
}
