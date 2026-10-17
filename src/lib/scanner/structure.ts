export interface ScannedLesson {
	relative_path: string;
	title: string;
	sort_order: number;
}

export interface Section {
	name: string;
	lessons: ScannedLesson[];
}

export interface CourseStructure {
	sections: Section[];
	lessons: ScannedLesson[];
	ignored_count: number;
}

export function comparePaths(a: string, b: string): number {
	const left = a.split("/");
	const right = b.split("/");
	for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
		const result = left[index].localeCompare(right[index], undefined, {
			numeric: true,
		});
		if (result !== 0) return result;
	}
	return left.length - right.length;
}

export function buildCourseStructure(
	paths: readonly string[],
): CourseStructure {
	const grouped = new Map<string, string[]>();
	let ignored_count = 0;
	for (const path of paths) {
		const segments = path.split("/");
		if (
			segments.some((segment) => !segment || segment.startsWith(".")) ||
			!/\.(mp4|m4v|webm)$/i.test(path)
		) {
			ignored_count += 1;
			continue;
		}
		const section = segments.slice(0, -1).join("/");
		const files = grouped.get(section) ?? [];
		files.push(path);
		grouped.set(section, files);
	}
	let sort_order = 0;
	const sections = [...grouped.entries()]
		.sort(([a], [b]) => comparePaths(a, b))
		.map(([name, files]) => ({
			name,
			lessons: files.sort(comparePaths).map((relative_path) => {
				const parts = relative_path.split("/");
				const filename = parts[parts.length - 1];
				const stem = filename.replace(/\.(mp4|m4v|webm)$/i, "");
				return {
					relative_path,
					title: stem.replace(/^\d+\s*[-._]\s*/, "") || stem,
					sort_order: sort_order++,
				};
			}),
		}));
	return {
		sections,
		lessons: sections.flatMap((section) => section.lessons),
		ignored_count,
	};
}
