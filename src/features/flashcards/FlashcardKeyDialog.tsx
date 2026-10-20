import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sessionKey } from "@/features/flashcards/service";

export function FlashcardKeyDialog({ onClose }: { onClose(): void }) {
	const id = useId();
	const [key, setKey] = useState(""),
		[busy, setBusy] = useState(false),
		[error, setError] = useState("");
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy) onClose();
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Z.ai API key</DialogTitle>
					<DialogDescription>
						Held in native session memory only. Never saved in the database or
						backups. Re-enter it after restarting Courseshelf.
					</DialogDescription>
				</DialogHeader>
				<form
					className="space-y-3"
					onSubmit={(event) => {
						event.preventDefault();
						const secret = key;
						setKey("");
						setBusy(true);
						setError("");
						void sessionKey(secret)
							.then(onClose)
							.catch((cause) =>
								setError(
									cause instanceof Error ? cause.message : String(cause),
								),
							)
							.finally(() => setBusy(false));
					}}
				>
					<Label htmlFor={id}>API key</Label>
					<Input
						id={id}
						type="password"
						autoComplete="off"
						spellCheck={false}
						maxLength={512}
						value={key}
						disabled={busy}
						onChange={(event) => setKey(event.target.value)}
					/>
					<Button type="submit" disabled={busy || !key.trim()}>
						Use for this session
					</Button>
					{error && (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}
				</form>
			</DialogContent>
		</Dialog>
	);
}
