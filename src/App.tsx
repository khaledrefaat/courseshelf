import { Library, Plus, Search } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import {
	HashRouter,
	Link,
	Route,
	Routes,
	useLocation,
	useNavigate,
} from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CoursePage } from "@/features/course/CoursePage";
import { AddCourseDialog } from "@/features/library/add-course/AddCourseDialog";
import { LibraryPage } from "@/features/library/LibraryPage";

const VideoSpike = import.meta.env.DEV
	? lazy(() => import("@/features/course/VideoSpike"))
	: null;

function Shell() {
	const [search, setSearch] = useState("");
	const [adding, setAdding] = useState(false);
	const [revision, setRevision] = useState(0);
	const [notice, setNotice] = useState<string | null>(null);
	const navigate = useNavigate();
	const courseRoute = useLocation().pathname.startsWith("/course/");
	return (
		<div
			className={
				courseRoute ? "h-dvh overflow-hidden" : "flex min-h-dvh flex-col"
			}
		>
			{!courseRoute && (
				<header className="border-b bg-card">
					<div className="mx-auto flex min-h-18 max-w-360 flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-3 sm:px-10">
						<Link
							to="/"
							className="flex items-center gap-2.5 text-lg font-bold"
						>
							<span className="flex size-7 items-center justify-center rounded-lg bg-brand text-brand-foreground">
								<Library aria-hidden="true" className="size-4" />
							</span>
							Courseshelf
						</Link>
						<div className="relative order-3 w-full sm:order-0 sm:w-2/5">
							<Search
								aria-hidden="true"
								className="absolute top-3.5 left-4 size-4 text-muted-foreground"
							/>
							<Input
								aria-label="Search courses by title"
								placeholder="Search courses by title"
								value={search}
								onChange={(event) => setSearch(event.target.value)}
								className="h-11 rounded-lg pl-10"
							/>
						</div>
						<Button
							className="h-11 gap-2 rounded-lg px-5"
							onClick={() => setAdding(true)}
						>
							<Plus />
							Add course
						</Button>
					</div>
				</header>
			)}
			{notice && !courseRoute && (
				<p
					role="status"
					className="mx-auto w-full max-w-360 px-5 pt-5 text-sm text-muted-foreground sm:px-10"
				>
					{notice}
				</p>
			)}
			{adding && (
				<AddCourseDialog
					onCancel={() => setAdding(false)}
					onAdded={(warning) => {
						setAdding(false);
						setNotice(warning);
						setSearch("");
						setRevision((value) => value + 1);
						navigate("/");
					}}
				/>
			)}
			<Suspense
				fallback={
					<p className="p-10" role="status">
						Loading…
					</p>
				}
			>
				<Routes>
					<Route
						path="/"
						element={
							<LibraryPage
								key={revision}
								search={search}
								onAddCourse={() => setAdding(true)}
							/>
						}
					/>
					<Route path="/course/:courseId" element={<CoursePage />} />
					<Route
						path="/course/:courseId/lesson/:lessonId"
						element={<CoursePage />}
					/>
					{VideoSpike && <Route path="/dev/spike" element={<VideoSpike />} />}
					<Route
						path="*"
						element={
							<main className="p-10">
								Page not found.{" "}
								<Link to="/" className="text-brand">
									Go to Library
								</Link>
							</main>
						}
					/>
				</Routes>
			</Suspense>
		</div>
	);
}

export default function App() {
	return (
		<HashRouter>
			<Shell />
		</HashRouter>
	);
}
