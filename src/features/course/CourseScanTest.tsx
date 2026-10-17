import { Button } from "@/components/ui/button";
import { useCourseScanCheck } from "@/features/course/useCourseScanCheck";

export function CourseScanTest() {
	const scan = useCourseScanCheck();
	return (
		<div>
			<Button disabled={scan.busy} onClick={scan.pickAndSync}>
				Choose course folder &amp; sync
			</Button>{" "}
			<Button
				disabled={scan.busy || scan.courseId === null}
				onClick={scan.syncAgain}
			>
				Sync last course
			</Button>
			<p role="status">{scan.status}</p>
		</div>
	);
}
