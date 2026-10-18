import { save } from "@tauri-apps/plugin-dialog";
import { MoreHorizontal } from "lucide-react";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { flushPendingData } from "@/features/course/closeProgress";
import { backupName } from "@/features/course-management/model";
import {
	manage,
	refreshManagement,
	useManagement,
} from "@/features/course-management/state";
import { errorMessage } from "@/features/library/add-course/folders";
import { nativePicker } from "@/features/library/add-course/nativePicker";
import { backupDatabase } from "@/lib/db/backup";

export function BackupMenu() {
	const [open, setOpen] = useState(false);
	const [picker, setPicker] = useState(false);
	const [error, setError] = useState("");
	const working = useRef(false);
	const { busy } = useManagement();
	async function backup() {
		if (working.current || busy) return;
		working.current = true;
		setError("");
		try {
			const path = await nativePicker.run(
				(value) => flushSync(() => setPicker(value)),
				() =>
					save({
						defaultPath: backupName(),
						filters: [{ name: "SQLite database", extensions: ["db"] }],
					}),
			);
			if (!path) return;
			const target = await manage(async () => {
				await flushPendingData();
				return backupDatabase(path);
			});
			refreshManagement(
				`Backup saved to ${target}. Manual restore instructions: docs/backup-and-restore.md. Cover images and videos are not included.`,
			);
			setOpen(false);
		} catch (cause) {
			setError(
				`${errorMessage(cause)} If an export was interrupted, its output may be incomplete; choose a new filename and retry.`,
			);
		} finally {
			working.current = false;
		}
	}
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					disabled={busy}
					render={
						<Button
							variant="outline"
							size="icon"
							aria-label="Library menu"
							className="bg-card"
						/>
					}
				>
					<MoreHorizontal />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="min-w-44">
					<DropdownMenuItem onClick={() => setOpen(true)}>
						Back up data...
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			{open && (
				<Dialog
					open
					modal={!picker}
					disablePointerDismissal={picker}
					onOpenChange={(value, details) => {
						if (!value) {
							if (working.current) details.cancel();
							else setOpen(false);
						}
					}}
				>
					<DialogContent showCloseButton={false} className="p-6 sm:max-w-120">
						<DialogHeader>
							<DialogTitle>Back up data</DialogTitle>
							<DialogDescription>
								The backup contains your courses, progress, notes and course
								paths. It does not contain cover images or videos. Restore is
								manual.
							</DialogDescription>
						</DialogHeader>
						<p className="text-sm text-muted-foreground">
							Choose a new .db filename outside course folders and the app's
							data folders. Existing files are never overwritten.
						</p>
						{error && (
							<p role="alert" className="text-sm text-destructive">
								{error}
							</p>
						)}
						<div className="flex justify-end gap-3">
							<Button
								variant="outline"
								disabled={busy || picker}
								onClick={() => setOpen(false)}
							>
								Cancel
							</Button>
							<Button disabled={busy || picker} onClick={() => void backup()}>
								{busy ? "Backing up…" : "Choose destination"}
							</Button>
						</div>
					</DialogContent>
				</Dialog>
			)}
		</>
	);
}
