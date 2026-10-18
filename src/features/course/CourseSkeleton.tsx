import { Skeleton } from "@/components/ui/skeleton";

function SidebarSectionSkeleton() {
	return (
		<div className="mb-2">
			<div className="flex min-h-12 items-center gap-2 rounded-lg px-3 py-3">
				<Skeleton className="size-4 rounded-sm" />
				<Skeleton className="h-4 min-w-0 flex-1" />
				<Skeleton className="h-3.5 w-8" />
			</div>
			<ul className="ml-5 space-y-3 px-2">
				<li>
					<Skeleton className="h-4 w-4/5" />
				</li>
				<li>
					<Skeleton className="h-4 w-3/5" />
				</li>
				<li>
					<Skeleton className="h-4 w-4/5" />
				</li>
			</ul>
		</div>
	);
}

// Mirrors the loaded page: header bar, lesson sidebar, then the player area.
export function CourseSkeleton() {
	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
			<div className="sr-only" role="status">
				Loading course…
			</div>
			<div className="flex h-16 shrink-0 items-center gap-4 border-b bg-header px-5 sm:px-10">
				<Skeleton className="size-9 rounded-lg bg-header-foreground/20" />
				<Skeleton className="h-4 w-64 bg-header-foreground/20" />
			</div>
			<div className="flex min-h-0 flex-1 overflow-hidden">
				<div className="h-full w-80 shrink-0 border-r bg-card px-4 py-7">
					<div className="mb-6 flex items-center gap-4 px-2">
						<Skeleton className="size-16 rounded-full" />
						<div className="min-w-0 flex-1 space-y-2">
							<Skeleton className="h-4 w-4/5" />
							<Skeleton className="h-3 w-1/2" />
						</div>
					</div>
					<SidebarSectionSkeleton />
					<SidebarSectionSkeleton />
				</div>
				<div className="min-w-0 flex-1 overflow-y-auto p-5 lg:px-10 lg:py-8">
					<Skeleton className="aspect-video w-full rounded-lg bg-player" />
					<div className="mt-6 flex flex-wrap items-start justify-between gap-5">
						<div className="min-w-0 flex-1 space-y-2">
							<Skeleton className="h-7 w-1/2" />
							<Skeleton className="h-3.5 w-48" />
						</div>
						<div className="flex gap-3">
							<Skeleton className="h-11 w-24 rounded-lg" />
							<Skeleton className="h-11 w-20 rounded-lg" />
							<Skeleton className="h-11 w-36 rounded-lg" />
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
