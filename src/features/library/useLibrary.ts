import { useEffect, useState } from "react";
import { useManagement } from "@/features/course-management/state";
import { retainCoverCache } from "@/features/library/coverCache";
import {
	type CourseSummary,
	listCourseSummaries,
} from "@/lib/db/courseSummaries";
import {
	getRegistrationStatus,
	initializePlayback,
	playbackErrorMessage,
	type RegistrationStatus,
} from "@/lib/playback";

export function useLibrary() {
	const { revision } = useManagement();
	const [courses, setCourses] = useState<CourseSummary[] | null>(null);
	const [registrations, setRegistrations] = useState<
		Map<number, Readonly<RegistrationStatus>>
	>(new Map());
	const [error, setError] = useState<string | null>(null);
	const [registrationError, setRegistrationError] = useState<string | null>(
		null,
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Management mutations explicitly invalidate these summaries.
	useEffect(() => {
		let active = true;
		const release = retainCoverCache();
		const registration = initializePlayback().catch((cause: unknown) => {
			if (active) setRegistrationError(playbackErrorMessage(cause));
		});
		void Promise.all([listCourseSummaries(), registration])
			.then(([data]) => {
				if (!active) return;
				const statuses = new Map<number, Readonly<RegistrationStatus>>();
				// Includes courses added after startup through the dev spike.
				for (const course of data) {
					const status = getRegistrationStatus(course.id);
					if (status) statuses.set(course.id, status);
				}
				setCourses(data);
				setRegistrations(statuses);
			})
			.catch(() => {
				if (active)
					setError(
						"Could not load your library. Please reopen the Library to retry.",
					);
			});
		return () => {
			active = false;
			release();
		};
	}, [revision]);
	return { courses, registrations, error, registrationError };
}
