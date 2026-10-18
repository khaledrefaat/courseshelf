import { useState } from "react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { archiveCourse } from "@/features/course-management/actions";
import {
	openCourseAction,
	refreshManagement,
	useManagement,
} from "@/features/course-management/state";
import { errorMessage } from "@/features/library/add-course/folders";
import { ContinueCard } from "@/features/library/ContinueCard";
import { CourseCard } from "@/features/library/CourseCard";
import { EmptyLibrary } from "@/features/library/EmptyLibrary";
import { LibrarySkeleton } from "@/features/library/LibrarySkeleton";
import {
	type CourseSort,
	continueCourse,
	courseStatus,
	filterCourses,
	type StatusFilter,
	sortCourses,
} from "@/features/library/model";
import { useLibrary } from "@/features/library/useLibrary";
import type { CourseSummary } from "@/lib/db/courseSummaries";

const tabs: { value: StatusFilter; label: string }[] = [
	{ value: "All", label: "All" },
	{ value: "In progress", label: "In progress" },
	{ value: "Completed", label: "Completed" },
	{ value: "New", label: "Not started" },
	{ value: "Archived", label: "Archived" },
];
const sorts: CourseSort[] = [
	"Last watched",
	"Title",
	"Progress",
	"Recently added",
];

export function LibraryPage({
	search,
	onAddCourse,
}: {
	search: string;
	onAddCourse?: () => void;
}) {
	const { courses, registrations, error, registrationError } = useLibrary();
	const [status, setStatus] = useState<StatusFilter>("All");
	const [sort, setSort] = useState<CourseSort>("Last watched");
	const { busy } = useManagement();
	if (error)
		return (
			<main className="p-10" role="alert">
				{error}
			</main>
		);
	if (!courses) return <LibrarySkeleton />;
	async function toggleArchive(course: CourseSummary) {
		try {
			await archiveCourse(course.id, course.archived_at === null);
		} catch (cause) {
			refreshManagement(errorMessage(cause));
		}
	}
	const currentCourses = courses;
	if (currentCourses.length === 0)
		return (
			<main className="flex flex-1 flex-col">
				<EmptyLibrary onAddCourse={onAddCourse} />
			</main>
		);
	const activeCourses = currentCourses.filter(
		(course) => course.archived_at === null,
	);
	const continuing = continueCourse(activeCourses);
	const visible = sortCourses(
		filterCourses(currentCourses, status, search),
		sort,
	);
	const grid = visible.length ? (
		<div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
			{visible.map((course) => (
				<CourseCard
					key={course.id}
					course={course}
					registration={registrations.get(course.id)}
					disabled={busy}
					onEditCover={() => openCourseAction(course.id, "edit")}
					onArchive={() => void toggleArchive(course)}
					onDelete={() => openCourseAction(course.id, "remove")}
					onLocate={() => openCourseAction(course.id, "locate")}
				/>
			))}
		</div>
	) : (
		<p className="py-16 text-center text-muted-foreground" role="status">
			No courses match
		</p>
	);
	return (
		<main className="mx-auto w-full max-w-360 px-5 py-10 sm:px-10">
			{registrationError && (
				<p className="mb-6 text-sm text-muted-foreground" role="alert">
					{registrationError}
				</p>
			)}
			{continuing && (
				<ContinueCard
					course={continuing}
					registration={registrations.get(continuing.id)}
				/>
			)}
			<Tabs
				value={status}
				onValueChange={(value) => {
					if (tabs.some((tab) => tab.value === value))
						setStatus(value as StatusFilter);
				}}
				className={continuing ? "mt-9" : ""}
			>
				<div className="mb-7 flex flex-wrap items-center justify-between gap-4">
					<TabsList className="h-10! max-w-full justify-start overflow-x-auto overflow-y-hidden bg-transparent p-0">
						{tabs.map((tab) => (
							<TabsTrigger
								key={tab.value}
								value={tab.value}
								className="h-10 flex-none cursor-pointer rounded-lg px-4 data-active:border-border data-active:bg-card"
							>
								{tab.label} ·{" "}
								{tab.value === "All"
									? activeCourses.length
									: tab.value === "Archived"
										? currentCourses.length - activeCourses.length
										: activeCourses.filter(
												(course) => courseStatus(course) === tab.value,
											).length}
							</TabsTrigger>
						))}
					</TabsList>
					<Select
						value={sort}
						onValueChange={(value) => {
							if (value && sorts.includes(value)) setSort(value);
						}}
					>
						<SelectTrigger
							aria-label="Sort courses"
							className="h-10! min-w-47 rounded-lg bg-card px-5"
						>
							<span>Sort:</span>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{sorts.map((value) => (
								<SelectItem key={value} value={value}>
									{value}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				{tabs.map((tab) => (
					<TabsContent key={tab.value} value={tab.value}>
						{status === tab.value && grid}
					</TabsContent>
				))}
			</Tabs>
		</main>
	);
}
