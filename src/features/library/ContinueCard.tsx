import { Play } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { FolderWarning } from "@/features/library/CourseCard";
import { CourseCover } from "@/features/library/CourseCover";
import { progressPercent } from "@/features/library/model";
import type { CourseSummary } from "@/lib/db/courseSummaries";
import type { RegistrationStatus } from "@/lib/playback";

export function ContinueCard({
	course,
	registration,
}: {
	course: CourseSummary;
	registration?: Readonly<RegistrationStatus>;
}) {
	const percent = progressPercent(course);
	const canResume =
		registration?.status === "registered" && course.resume_lesson_id !== null;
	return (
		<section
			aria-label="Continue watching"
			className="grid gap-6 rounded-lg border bg-card p-5 shadow-card md:grid-cols-[minmax(0,480fr)_minmax(0,798fr)] md:gap-10"
		>
			<Link
				to={`/course/${course.id}`}
				aria-label={`View course ${course.title}`}
				className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
			>
				<CourseCover
					course={course}
					className="flex aspect-video items-center justify-center rounded-lg"
				>
					<span className="z-10 flex size-15 items-center justify-center rounded-full bg-player/60 text-player-foreground">
						<Play aria-hidden="true" className="size-7 fill-current" />
					</span>
				</CourseCover>
			</Link>
			<div className="flex min-w-0 flex-col justify-center py-3 md:pr-5">
				<p className="text-xs font-semibold tracking-widest text-brand">
					CONTINUE WHERE YOU LEFT OFF
				</p>
				<h1 className="mt-4 text-3xl font-bold tracking-tight">
					{course.title}
				</h1>
				<p className="mt-4 text-sm text-muted-foreground">
					{course.resume_lesson_title}
				</p>
				<div className="mt-5 flex flex-wrap items-center gap-4">
					<Progress
						value={percent}
						aria-label="Course progress"
						className="min-w-20 flex-1 [&_[data-slot=progress-track]]:h-2 [&_[data-slot=progress-track]]:bg-border"
					/>
					<span className="font-semibold text-brand">{percent}%</span>
					<span className="text-xs text-muted-foreground">
						{course.completed_lessons} / {course.total_lessons} lessons
					</span>
				</div>
				<div className="mt-6 flex flex-wrap items-center gap-3">
					{canResume ? (
						<Button
							nativeButton={false}
							render={
								<Link
									to={`/course/${course.id}/lesson/${course.resume_lesson_id}`}
								/>
							}
							className="h-12 rounded-lg px-7"
						>
							Resume
						</Button>
					) : (
						<Button
							disabled
							title={registration?.message ?? "Checking folder access"}
							className="h-12 rounded-lg px-7"
						>
							Resume
						</Button>
					)}
					<Button
						variant="outline"
						nativeButton={false}
						render={<Link to={`/course/${course.id}`} />}
						className="h-12 rounded-lg bg-card px-5"
					>
						View course
					</Button>
					<FolderWarning registration={registration} />
				</div>
			</div>
		</section>
	);
}
