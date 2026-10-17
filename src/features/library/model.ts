import type { CourseSummary } from "@/lib/db/courseSummaries";

export type CourseStatus = "New" | "In progress" | "Completed";
export type StatusFilter = "All" | CourseStatus;
export type CourseSort =
	| "Last watched"
	| "Title"
	| "Progress"
	| "Recently added";

export function courseStatus(course: CourseSummary): CourseStatus {
	if (
		course.total_lessons > 0 &&
		course.completed_lessons === course.total_lessons
	)
		return "Completed";
	return course.completed_lessons === 0 && course.last_watched_at === null
		? "New"
		: "In progress";
}

export function progressPercent(course: CourseSummary): number {
	return course.total_lessons === 0
		? 0
		: Math.round((100 * course.completed_lessons) / course.total_lessons);
}

export function filterCourses(
	courses: CourseSummary[],
	status: StatusFilter,
	search: string,
): CourseSummary[] {
	const term = search.trim().toLocaleLowerCase();
	return courses.filter(
		(course) =>
			(status === "All" || courseStatus(course) === status) &&
			course.title.toLocaleLowerCase().includes(term),
	);
}

export function sortCourses(
	courses: CourseSummary[],
	sort: CourseSort,
): CourseSummary[] {
	return [...courses].sort((a, b) => {
		let order: number;
		switch (sort) {
			case "Title":
				order = a.title.localeCompare(b.title, undefined, { numeric: true });
				break;
			case "Progress":
				order = progressPercent(b) - progressPercent(a);
				break;
			case "Recently added":
				order = b.created_at.localeCompare(a.created_at);
				break;
			case "Last watched":
				order = (b.last_watched_at ?? "").localeCompare(
					a.last_watched_at ?? "",
				);
				break;
		}
		return order || b.id - a.id;
	});
}

export function continueCourse(
	courses: CourseSummary[],
): CourseSummary | undefined {
	return sortCourses(courses, "Last watched").find(
		(course) =>
			course.last_watched_at !== null &&
			courseStatus(course) !== "Completed" &&
			course.resume_lesson_id !== null,
	);
}
