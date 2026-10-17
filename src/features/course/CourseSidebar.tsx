import { Check, ChevronDown, ChevronRight, Circle } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { buildOutline } from "@/features/course/outline";
import { ProgressRing } from "@/features/course/ProgressRing";
import type { Course } from "@/lib/db/courses";

export function CourseSidebar({
	course,
	model,
	lessonId,
}: {
	course: Course;
	model: ReturnType<typeof buildOutline>;
	lessonId: number;
}) {
	const [expanded, setExpanded] = useState(
		() => new Set(model.section ? [model.section.name] : []),
	);
	const currentRow = useRef<HTMLAnchorElement>(null);
	const container = useRef<HTMLElement>(null);
	const [revealedId, setRevealedId] = useState(lessonId);
	if (revealedId !== lessonId) {
		setRevealedId(lessonId);
		const current = model.sections.find((section) =>
			section.lessons.some((lesson) => lesson.id === lessonId),
		);
		if (current && !expanded.has(current.name))
			setExpanded((previous) => new Set([...previous, current.name]));
	}
	useLayoutEffect(() => {
		const root = container.current;
		const row = currentRow.current;
		if (!root || !row || row.dataset.lessonId !== String(lessonId)) return;
		// Scroll only the sidebar, never the window/player. Completion is not a dependency.
		const bounds = root.getBoundingClientRect();
		const target = row.getBoundingClientRect();
		if (target.top < bounds.top) root.scrollTop -= bounds.top - target.top;
		else if (target.bottom > bounds.bottom)
			root.scrollTop += target.bottom - bounds.bottom;
	}, [lessonId]);
	return (
		<aside
			ref={container}
			aria-label="Course lessons"
			className="h-full w-80 shrink-0 overflow-y-auto overscroll-contain border-r bg-card px-4 py-7"
		>
			<div className="mb-6 flex items-center gap-4 px-2">
				<ProgressRing
					percent={model.percent}
					completed={model.completed}
					total={model.total}
				/>
				<div className="min-w-0">
					<h2 className="text-base font-bold leading-tight">{course.title}</h2>
					<p className="mt-2 text-xs text-muted-foreground">
						{model.completed} of {model.total} lessons
					</p>
				</div>
			</div>
			{model.sections.map((section) => (
				<section key={section.name} className="mb-2">
					<button
						type="button"
						aria-expanded={expanded.has(section.name)}
						className="flex min-h-12 w-full items-center gap-2 rounded-lg px-3 py-3 text-left text-sm font-semibold outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
						onClick={() =>
							setExpanded((previous) => {
								const next = new Set(previous);
								if (next.has(section.name)) next.delete(section.name);
								else next.add(section.name);
								return next;
							})
						}
					>
						{expanded.has(section.name) ? (
							<ChevronDown
								aria-hidden="true"
								className="size-4 shrink-0 text-muted-foreground"
							/>
						) : (
							<ChevronRight
								aria-hidden="true"
								className="size-4 shrink-0 text-muted-foreground"
							/>
						)}
						<span className="min-w-0 flex-1 break-words">{section.label}</span>
						<span className="shrink-0 text-xs font-normal text-muted-foreground">
							{section.completed}/{section.total}
						</span>
					</button>
					{expanded.has(section.name) && (
						<ul className="ml-5">
							{section.lessons.map((lesson) => (
								<li key={lesson.id}>
									<Link
										data-lesson-id={lesson.id}
										ref={lesson.id === lessonId ? currentRow : undefined}
										to={`/course/${course.id}/lesson/${lesson.id}`}
										aria-current={lesson.id === lessonId ? "page" : undefined}
										className={`flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm leading-tight outline-none focus-visible:ring-2 focus-visible:ring-ring ${lesson.id === lessonId ? "bg-brand-soft font-medium text-brand" : "hover:bg-muted"}`}
									>
										{lesson.completed ? (
											<Check
												aria-hidden="true"
												className="size-4.5 shrink-0 rounded-full bg-brand p-0.5 text-brand-foreground"
											/>
										) : (
											<Circle
												aria-hidden="true"
												className="size-4.5 shrink-0 text-muted-foreground/40"
											/>
										)}
										<span className="min-w-0 break-words">{lesson.title}</span>
										<span className="sr-only">
											{lesson.completed ? " (completed)" : " (not completed)"}
										</span>
									</Link>
								</li>
							))}
						</ul>
					)}
				</section>
			))}
		</aside>
	);
}
