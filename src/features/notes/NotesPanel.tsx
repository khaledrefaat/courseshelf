import { Check } from "lucide-react";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AllNotes } from "@/features/notes/AllNotes";
import type { NoteLesson } from "@/features/notes/controller";
import { LessonNotes } from "@/features/notes/LessonNotes";
import { useNotes } from "@/features/notes/useNotes";

export function NotesPanel({
	courseId,
	lessonId,
	lessons,
}: {
	courseId: number;
	lessonId: number;
	lessons: readonly NoteLesson[];
}) {
	const controller = useNotes(courseId, lessonId, lessons);
	const [tab, setTab] = useState("lesson");
	const course = controller.course(courseId);
	const draft = controller.get(lessonId);
	return (
		<section
			aria-label="Course notes"
			className="mt-6 rounded-xl border bg-card px-6 pt-5 pb-4 shadow-card"
		>
			<Tabs
				value={tab}
				onValueChange={(value) => {
					void controller.flush(lessonId);
					setTab(String(value));
				}}
				className="gap-4"
			>
				<div className="flex flex-wrap items-center justify-between gap-3">
					<TabsList className="h-10! max-w-full justify-start overflow-x-auto overflow-y-hidden bg-transparent p-0">
						<TabsTrigger
							value="lesson"
							className="h-10 flex-none rounded-lg px-4 data-active:border-border data-active:bg-card"
						>
							Lesson notes
						</TabsTrigger>
						<TabsTrigger
							value="all"
							className="h-10 flex-none rounded-lg px-4 data-active:border-border data-active:bg-card"
						>
							All notes for this course · {controller.entries(courseId).length}
						</TabsTrigger>
					</TabsList>
					{draft && (
						<div
							role="status"
							className={`flex items-center gap-1 text-xs ${draft.status === "error" ? "text-destructive" : draft.status === "saved" ? "text-brand" : "text-muted-foreground"}`}
						>
							{draft.status === "saved" ? (
								<>
									<Check aria-hidden="true" className="size-3" />
									Saved
								</>
							) : draft.status === "saving" ? (
								"Saving..."
							) : (
								<>
									Couldn't save{" "}
									<button
										type="button"
										className="ml-2 underline"
										onClick={() => void controller.flush(lessonId)}
									>
										Retry
									</button>
								</>
							)}
						</div>
					)}
				</div>
				{course?.error && (
					<p role="alert" className="text-sm text-destructive">
						{course.error}{" "}
						<button
							type="button"
							className="underline"
							onClick={() => void controller.loadCourse(courseId, lessons)}
						>
							Retry
						</button>
					</p>
				)}
				{!course?.ready ? (
					<p role="status" className="py-8 text-sm text-muted-foreground">
						Loading notes…
					</p>
				) : (
					<>
						<TabsContent value="lesson">
							<LessonNotes key={lessonId} lessonId={lessonId} />
						</TabsContent>
						<TabsContent value="all">
							<AllNotes courseId={courseId} />
						</TabsContent>
					</>
				)}
			</Tabs>
		</section>
	);
}
