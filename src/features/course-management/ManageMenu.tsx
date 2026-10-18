import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { rescan } from "@/features/course-management/actions";
import {
  openCourseAction,
  refreshManagement,
  useManagement,
} from "@/features/course-management/state";
import { errorMessage } from "@/features/library/add-course/folders";
import { getById } from "@/lib/db/courses";
export function ManageMenu({ courseId }: { courseId: number }) {
  const { busy } = useManagement();
  async function scan() {
    try {
      const course = await getById(courseId);
      if (course) await rescan(course);
    } catch (cause) {
      refreshManagement(errorMessage(cause), courseId);
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={busy}
        render={
          <Button
            variant="outline"
            className="ml-auto shrink-0 bg-card/90 text-foreground"
          />
        }
      >
        Manage
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem disabled={busy} onClick={() => void scan()}>
          Rescan folder
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={busy}
          onClick={() => openCourseAction(courseId, "edit")}
        >
          Edit course
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={busy}
          onClick={() => openCourseAction(courseId, "locate")}
        >
          Locate folder
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={busy}
          variant="destructive"
          onClick={() => openCourseAction(courseId, "remove")}
        >
          Remove course
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
