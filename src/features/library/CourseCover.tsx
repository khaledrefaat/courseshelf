import { useEffect, useState } from "react";
import { loadCover } from "@/features/library/coverCache";
import { coverGradient, coverLabel } from "@/lib/cover-gradients";
import type { CourseSummary } from "@/lib/db/courseSummaries";

export function CourseCover({
	course,
	children,
	className = "",
}: {
	course: Pick<CourseSummary, "id" | "title" | "cover_path">;
	children?: React.ReactNode;
	className?: string;
}) {
	const [image, setImage] = useState<{ path: string; url: string } | null>(
		null,
	);
	const [failed, setFailed] = useState<string | null>(null);
	useEffect(() => {
		let active = true;
		if (course.cover_path) {
			const path = course.cover_path;
			void loadCover(path).then((url) => {
				if (active && url) setImage({ path, url });
			});
		}
		return () => {
			active = false;
		};
	}, [course.cover_path]);
	const url =
		image?.path === course.cover_path && failed !== image?.url
			? image?.url
			: null;
	return (
		<div
			className={`relative overflow-hidden ${className}`}
			style={{ background: coverGradient(course.id) }}
		>
			{url ? (
				<img
					src={url}
					alt=""
					className="absolute size-full object-cover"
					onError={() => setFailed(url)}
				/>
			) : (
				<span className="absolute bottom-3 left-3.5 text-xl font-bold text-foreground/35">
					{coverLabel(course.title)}
				</span>
			)}
			{children}
		</div>
	);
}
