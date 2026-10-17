import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

function BookshelfIllustration() {
	return (
		<svg aria-hidden="true" viewBox="0 0 280 160" className="h-40 w-70">
			<path
				d="M12 145H268"
				stroke="var(--border)"
				strokeWidth="10"
				strokeLinecap="round"
			/>
			<rect x="37" y="70" width="26" height="70" rx="5" fill="var(--brand)" />
			<rect
				x="69"
				y="50"
				width="26"
				height="90"
				rx="5"
				fill="var(--muted-foreground)"
				opacity=".28"
			/>
			<rect
				x="101"
				y="80"
				width="26"
				height="60"
				rx="5"
				fill="var(--border)"
				stroke="var(--muted-foreground)"
				strokeOpacity=".2"
			/>
			<path
				d="M177 140L199 68L223 76L201 140Z"
				fill="var(--brand)"
				opacity=".45"
			/>
			<path
				d="M37 20H77M37 36H61"
				stroke="var(--muted-foreground)"
				strokeOpacity=".28"
				strokeWidth="5"
				strokeLinecap="round"
			/>
			<path
				d="M232 30Q232 46 214 51"
				fill="none"
				stroke="var(--brand)"
				strokeWidth="5"
				strokeLinecap="round"
			/>
		</svg>
	);
}

export function EmptyLibrary({ onAddCourse }: { onAddCourse?: () => void }) {
	return (
		<section className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
			<BookshelfIllustration />
			<h1 className="mt-10 text-4xl font-bold tracking-tight">
				Your shelf is empty
			</h1>
			<p className="mt-5 max-w-100 text-base leading-relaxed text-muted-foreground">
				Add a folder of video lessons from your computer and Courseshelf will
				track every lesson you finish.
			</p>
			<Button
				className="mt-7 h-14 gap-2 rounded-lg px-9 text-base"
				onClick={onAddCourse}
			>
				<Plus />
				Add your first course
			</Button>
		</section>
	);
}
