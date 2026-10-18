import { invoke } from "@tauri-apps/api/core";
import { list } from "@/lib/db/courses";
import { getDb } from "@/lib/db/db";
import { trackProgressWrite } from "@/lib/db/progressWrites";

export async function backupDatabase(path: string): Promise<string> {
	const courseRoots = (await list()).map((course) => course.root_path);
	const target = await invoke<string>("validate_backup_target", {
		path,
		courseRoots,
		verify: false,
	});
	const db = await getDb();
	// SQLite handles WAL and generates a consistent snapshot. Never copy the live file.
	await trackProgressWrite(async () => {
		await db.execute("VACUUM INTO $1", [target]);
	});
	const verified = await invoke<string>("validate_backup_target", {
		path,
		courseRoots,
		verify: true,
	});
	if (verified !== target)
		throw new Error(
			"The backup destination changed during export. Verify the file before using it.",
		);
	return target;
}
