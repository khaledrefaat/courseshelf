import { Library, Plus, Search } from "lucide-react";
import { useState } from "react";
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
import { CourseSubtitlesStatus } from "@/features/course/CourseSubtitlesDialog";
import { ManagementHost } from "@/features/course-management/ManagementHost";
import { useManagement } from "@/features/course-management/state";
import { FlashcardJobStatus } from "@/features/flashcards/FlashcardsPanel";
import { AddCourseDialog } from "@/features/library/add-course/AddCourseDialog";
import { LibraryPage } from "@/features/library/LibraryPage";
import { NotesWarnings } from "@/features/notes/NotesWarnings";

function Shell() {
  const management = useManagement();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const navigate = useNavigate();
  const courseRoute = useLocation().pathname.startsWith("/course/");
  return (
    <div
      className={
        courseRoute
          ? "flex h-dvh flex-col overflow-hidden"
          : "flex min-h-dvh flex-col"
      }
    >
      <NotesWarnings />
      <ManagementHost />
      <CourseSubtitlesStatus />
      <FlashcardJobStatus />
      {!courseRoute && (
        <header className="border-b bg-header text-header-foreground">
          <div className="mx-auto flex min-h-18 max-w-360 flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-3 sm:px-10">
            <Link
              to="/"
              className="flex items-center gap-2.5 text-lg font-bold"
            >
              <span className="flex size-7 items-center justify-center rounded-lg bg-header-foreground/15 text-header-foreground dark:bg-brand dark:text-brand-foreground">
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
                className="h-11 rounded-lg bg-header-search pl-10 text-foreground dark:bg-input/30"
              />
            </div>
            <Button
              disabled={management.busy}
              className="h-11 cursor-pointer gap-2 rounded-lg bg-card px-5 text-foreground hover:bg-card/90 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/80"
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
      <Routes>
        <Route
          path="/"
          element={
            <LibraryPage
              key={revision}
              search={search}
              onAddCourse={() => {
                if (!management.busy) setAdding(true);
              }}
            />
          }
        />
        <Route path="/course/:courseId" element={<CoursePage />} />
        <Route
          path="/course/:courseId/lesson/:lessonId"
          element={<CoursePage />}
        />
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
