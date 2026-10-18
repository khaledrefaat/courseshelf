import { ArrowLeft, Check, ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { CourseSidebar } from "@/features/course/CourseSidebar";
import { CourseSkeleton } from "@/features/course/CourseSkeleton";
import { LessonPlayer } from "@/features/course/LessonPlayer";
import {
	buildOutline,
	courseDestination,
	parseId,
} from "@/features/course/outline";
import { useCourse } from "@/features/course/useCourse";
import { usePlayerControls } from "@/features/course/usePlayerControls";
import { ManageMenu } from "@/features/course-management/ManageMenu";
import { refreshedLessonMissing } from "@/features/course-management/model";
import { useManagement } from "@/features/course-management/state";
import { NotesPanel } from "@/features/notes/NotesPanel";
import type { CourseOutline, OutlineLesson } from "@/lib/db/courseOutline";

function CourseMessage({
	message,
	courseId,
}: {
	message: string;
	courseId?: number;
}) {
	return (
		<main className="p-10">
			<h1 className="text-xl font-bold">{message}</h1>
			{courseId && <ManageMenu courseId={courseId} />}
			<Link to="/" className="mt-4 inline-block text-brand hover:underline">
				Back to Library
			</Link>
		</main>
	);
}

function CourseContent({
	outline,
	lesson,
	progressError,
	saving,
	toggleCompletion,
	completeLesson,
}: {
	outline: CourseOutline;
	lesson: OutlineLesson;
	progressError: string | null;
	saving: boolean;
	toggleCompletion: (id: number) => Promise<void>;
	completeLesson: (id: number) => Promise<void>;
}) {
	const navigate = useNavigate();
	const management = useManagement();
	const controls = usePlayerControls();
	const { focus } = controls;
	// Only navigation changes focus, never completion, position or note saves.
	useLayoutEffect(() => {
		void lesson.id;
		focus();
	}, [lesson.id, focus]);
	const model = useMemo(
		() => buildOutline(outline.lessons, lesson.id),
		[outline.lessons, lesson.id],
	);
	const autoplayTarget = useRef<number | null>(null);
	const autoplay = autoplayTarget.current === lesson.id;
	useEffect(() => {
		if (autoplayTarget.current === lesson.id) autoplayTarget.current = null;
	}, [lesson.id]);
	function move(target: OutlineLesson | null) {
		if (!target) return;
		autoplayTarget.current = target.id;
		focus();
		navigate(`/course/${outline.course.id}/lesson/${target.id}`);
	}
	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
			<header
				className={
					controls.expanded
						? "hidden"
						: "flex h-16 shrink-0 items-center gap-4 border-b bg-header px-5 text-header-foreground sm:px-10"
				}
			>
				<Button
					variant="outline"
					size="icon"
					nativeButton={false}
					render={<Link to="/" aria-label="Back to Library" />}
					className="size-9 shrink-0 bg-card/90 text-foreground"
				>
					<ArrowLeft />
				</Button>
				<nav
					aria-label="Breadcrumb"
					className="flex min-w-0 items-center gap-3 text-sm"
				>
					<Link
						to="/"
						className="text-header-foreground/80 hover:text-header-foreground dark:text-muted-foreground dark:hover:text-brand"
					>
						Library
					</Link>
					<ChevronRight aria-hidden="true" className="size-4 shrink-0" />
					<Link
						to={`/course/${outline.course.id}`}
						className="truncate text-header-foreground/80 hover:text-header-foreground dark:text-muted-foreground dark:hover:text-brand"
					>
						{outline.course.title}
					</Link>
					<ChevronRight aria-hidden="true" className="size-4 shrink-0" />
					<span className="truncate font-semibold" aria-current="page">
						{lesson.title}
					</span>
				</nav>
				<ManageMenu courseId={outline.course.id} />
			</header>
			<div className="flex min-h-0 flex-1 overflow-hidden">
				<div className={controls.expanded ? "hidden" : "contents"}>
					<CourseSidebar
						course={outline.course}
						model={model}
						lessonId={lesson.id}
						onLessonSelect={focus}
					/>
				</div>
				<main
					className={
						controls.expanded
							? "min-w-0 flex-1 overflow-hidden"
							: "min-w-0 flex-1 overflow-y-auto p-5 lg:px-10 lg:py-8"
					}
				>
					<section
						ref={controls.container}
						tabIndex={-1}
						aria-label="Lesson player"
						className={
							controls.expanded
								? "fixed inset-0 z-50 bg-player outline-none"
								: "relative outline-none"
						}
					>
						<LessonPlayer
							key={`${lesson.id}:${outline.course.root_path}:${management.playbackVersions.get(outline.course.id) ?? 0}`}
							courseId={outline.course.id}
							lesson={lesson}
							autoplay={autoplay}
							onComplete={() => completeLesson(lesson.id)}
							expanded={controls.expanded}
							bindPlayer={controls.bindPlayer}
							onBeforePause={controls.exit}
							nextLesson={model.next}
							onAdvance={() => move(model.next)}
							advanceBlocked={management.busy || management.selection !== null}
							bindAutoAdvance={controls.bindAutoAdvance}
						/>
						<div
							aria-hidden="true"
							className={`pointer-events-none absolute inset-x-0 top-1/2 z-10 flex -translate-y-1/2 justify-center transition-opacity duration-200 ${controls.indicator.visible ? "opacity-100" : "opacity-0"}`}
						>
							<span className="rounded-lg bg-player/80 px-4 py-2 text-lg font-medium text-player-foreground">
								{controls.indicator.text}
							</span>
						</div>
					</section>
					<div className={controls.expanded ? "hidden" : undefined}>
						<div className="mt-6 flex flex-wrap items-start justify-between gap-5">
							<div className="min-w-0 flex-1">
								<h1 className="text-2xl font-bold leading-tight">
									{lesson.title}
								</h1>
								<p className="mt-1.5 text-sm text-muted-foreground">
									{model.section?.label} · Lesson {model.position} of{" "}
									{model.section?.total ?? 0}
								</p>
							</div>
							<div className="flex flex-wrap gap-3">
								<Button
									variant="outline"
									disabled={!model.previous}
									onClick={() => move(model.previous)}
									className="h-11 bg-card px-5"
								>
									Previous
								</Button>
								<Button
									variant="outline"
									disabled={!model.next}
									onClick={() => move(model.next)}
									className="h-11 bg-card px-5"
								>
									Next
								</Button>
								<Button
									disabled={saving}
									aria-pressed={lesson.completed}
									onClick={() => void toggleCompletion(lesson.id)}
									title={
										lesson.completed ? "Click to mark as incomplete" : undefined
									}
									className={`h-11 gap-2 px-5 ${lesson.completed ? "bg-brand-soft text-brand hover:bg-brand-soft/80" : ""}`}
								>
									{lesson.completed && <Check aria-hidden="true" />}
									{lesson.completed ? "Completed · Undo" : "Mark as complete"}
								</Button>
							</div>
						</div>
						{progressError && (
							<p role="alert" className="mt-4 text-sm text-destructive">
								{progressError}
							</p>
						)}
						<NotesPanel
							courseId={outline.course.id}
							lessonId={lesson.id}
							lessons={outline.lessons}
						/>
					</div>
				</main>
			</div>
		</div>
	);
}

function LoadedCourse({
	courseId,
	rawLessonId,
}: {
	courseId: number;
	rawLessonId: string | undefined;
}) {
	const {
		data,
		error,
		progressError,
		saving,
		toggleCompletion,
		completeLesson,
	} = useCourse(courseId);
	const previouslyViewed = useRef<number | null>(null);
	if (error) return <CourseMessage message={error} />;
	if (!data) return <CourseSkeleton />;
	const destination = courseDestination(
		data.outline,
		rawLessonId,
		data.resumeId,
	);
	if (destination.kind === "lesson")
		previouslyViewed.current = destination.lesson.id;
	if (
		destination.kind === "not-found" &&
		previouslyViewed.current === Number(rawLessonId) &&
		refreshedLessonMissing(
			previouslyViewed.current,
			data.outline?.lessons.map((row) => row.id) ?? [],
		)
	)
		return <Navigate replace to={`/course/${courseId}`} />;
	if (destination.kind === "not-found")
		return <CourseMessage message={destination.message} />;
	if (destination.kind === "empty")
		return (
			<CourseMessage
				courseId={courseId}
				message="This course has no available lessons. Its folder may need to be synced."
			/>
		);
	if (destination.kind === "redirect")
		return (
			<Navigate
				replace
				to={`/course/${courseId}/lesson/${destination.lessonId}`}
			/>
		);
	if (!data.outline) return null;
	return (
		<CourseContent
			outline={data.outline}
			lesson={destination.lesson}
			progressError={progressError}
			saving={saving}
			toggleCompletion={toggleCompletion}
			completeLesson={completeLesson}
		/>
	);
}

export function CoursePage() {
	const { courseId: rawCourseId, lessonId } = useParams();
	const courseId = parseId(rawCourseId);
	return courseId === null ? (
		<CourseMessage message="Course not found." />
	) : (
		<LoadedCourse key={courseId} courseId={courseId} rawLessonId={lessonId} />
	);
}
