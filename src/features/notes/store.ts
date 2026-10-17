import { registerProgressFlush } from "@/features/course/closeProgress";
import { createNotesController } from "@/features/notes/controller";
import { get, listByCourse, save } from "@/lib/db/notes";
import { trackProgressWrite } from "@/lib/db/progressWrites";

// Session-long controller: failed drafts survive route and tab unmounts.
export const notesController = createNotesController({
	load: listByCourse,
	write: async (lessonId, content) => {
		await save(lessonId, content);
		return get(lessonId);
	},
	track: trackProgressWrite,
});
const unregister = registerProgressFlush(() => {
	void notesController.flushCourse();
});
if (import.meta.hot) import.meta.hot.dispose(unregister);
