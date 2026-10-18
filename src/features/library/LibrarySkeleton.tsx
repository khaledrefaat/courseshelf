import { Skeleton } from "@/components/ui/skeleton";

const tabWidths = ["w-22", "w-37", "w-35", "w-37", "w-33"];

function CourseCardSkeleton() {
	return (
		<div className="overflow-hidden rounded-lg border bg-card shadow-card">
			<Skeleton className="aspect-video rounded-none" />
			<div className="space-y-2.5 p-4">
				<Skeleton className="h-4 w-4/5" />
				<div className="flex items-center justify-between">
					<Skeleton className="h-3 w-20" />
					<Skeleton className="h-3 w-8" />
				</div>
				<Skeleton className="h-1.5 w-full rounded-sm" />
			</div>
		</div>
	);
}

// Mirrors the loaded page: continue card, tabs + sort row, then the card grid.
export function LibrarySkeleton() {
	return (
		<main className="mx-auto w-full max-w-360 px-5 py-10 sm:px-10">
			<div className="sr-only" role="status">
				Loading your library…
			</div>
			<div className="grid gap-6 rounded-lg border bg-card p-5 shadow-card md:grid-cols-[minmax(0,480fr)_minmax(0,798fr)] md:gap-10">
				<Skeleton className="aspect-video rounded-lg" />
				<div className="flex min-w-0 flex-col justify-center gap-5 py-3 md:pr-5">
					<Skeleton className="h-3 w-28" />
					<Skeleton className="h-8 w-3/5 max-w-96" />
					<Skeleton className="h-4 w-2/5 max-w-64" />
					<div className="flex items-center gap-4">
						<Skeleton className="h-2 min-w-20 flex-1" />
						<Skeleton className="h-4 w-9" />
					</div>
					<div className="flex flex-wrap gap-3">
						<Skeleton className="h-12 w-28 rounded-lg" />
						<Skeleton className="h-12 w-28 rounded-lg" />
					</div>
				</div>
			</div>
			<div className="mt-9 mb-7 flex flex-wrap items-center justify-between gap-4">
				<div className="flex gap-2">
					{tabWidths.map((width) => (
						<Skeleton key={width} className={`h-10 rounded-lg ${width}`} />
					))}
				</div>
				<Skeleton className="h-10 w-47 rounded-lg" />
			</div>
			<div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
				<CourseCardSkeleton />
				<CourseCardSkeleton />
				<CourseCardSkeleton />
				<CourseCardSkeleton />
				<CourseCardSkeleton />
				<CourseCardSkeleton />
				<CourseCardSkeleton />
				<CourseCardSkeleton />
			</div>
		</main>
	);
}
