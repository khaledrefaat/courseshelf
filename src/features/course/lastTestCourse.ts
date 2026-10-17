export const lastCourseKey = "courseshelf:scanner-spike:last-course-id";

export function readLastCourse(): number | null {
	try {
		const value = Number(localStorage.getItem(lastCourseKey));
		return Number.isSafeInteger(value) && value > 0 ? value : null;
	} catch {
		return null;
	}
}
