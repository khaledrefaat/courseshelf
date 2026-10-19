import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { CourseSubtitlesDialog } from "@/features/course/CourseSubtitlesDialog";
import { LocateDialog } from "@/features/course-management/LocateDialog";
import {
	closeCourseAction,
	openCourseAction,
	useManagement,
} from "@/features/course-management/state";
import { DeleteCourseDialog } from "@/features/library/edit-cover/DeleteCourseDialog";
import { EditCoverDialog } from "@/features/library/edit-cover/EditCoverDialog";
import { type Course, getById } from "@/lib/db/courses";
export function ManagementHost() {
	const { selection, notice, locateId } = useManagement();
	const [course, setCourse] = useState<Course | null>(null);
	const [error, setError] = useState("");
	const navigate = useNavigate();
	useEffect(() => {
		let active = true;
		setCourse(null);
		setError("");
		if (selection)
			void getById(selection.courseId)
				.then((row) => {
					if (active) {
						setCourse(row);
						if (!row) setError("Course no longer exists.");
					}
				})
				.catch(() => {
					if (active) setError("Could not load course.");
				});
		return () => {
			active = false;
		};
	}, [selection]);
	return (
		<>
			{notice && (
				<p
					role="status"
					className="shrink-0 border-b bg-card px-5 py-2 text-sm text-muted-foreground"
				>
					{notice}{" "}
					{locateId && (
						<button
							type="button"
							className="ml-2 text-brand underline"
							onClick={() => openCourseAction(locateId, "locate")}
						>
							Locate folder
						</button>
					)}
				</p>
			)}
			{error && (
				<p role="alert" className="p-4 text-destructive">
					{error}{" "}
					<button type="button" onClick={closeCourseAction}>
						Dismiss
					</button>
				</p>
			)}
			{selection &&
				course &&
				(selection.action === "subtitles" ? (
					<CourseSubtitlesDialog
						key={course.id}
						course={course}
						onClose={closeCourseAction}
					/>
				) : selection.action === "edit" ? (
					<EditCoverDialog
						key={course.id}
						editDetails
						course={course}
						onCancel={closeCourseAction}
						onSaved={closeCourseAction}
					/>
				) : selection.action === "remove" ? (
					<DeleteCourseDialog
						course={course}
						onCancel={closeCourseAction}
						onDeleted={() => {
							closeCourseAction();
							navigate("/", { replace: true });
						}}
					/>
				) : (
					<LocateDialog
						course={course}
						onCancel={closeCourseAction}
						onDone={closeCourseAction}
					/>
				))}
		</>
	);
}
