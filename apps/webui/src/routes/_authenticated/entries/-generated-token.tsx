import { Copy } from "lucide-react";
import { useRef, useState } from "react";

const CopyResult = {
	Copied: "copied",
	Manual: "manual",
} as const;
type CopyResult = (typeof CopyResult)[keyof typeof CopyResult];

export function GeneratedToken({
	token,
	onDismiss,
}: {
	token: string;
	onDismiss: () => void;
}) {
	const input = useRef<HTMLInputElement>(null);
	const [copyResult, setCopyResult] = useState<CopyResult | null>(null);
	const selectToken = () => {
		input.current?.focus();
		input.current?.select();
	};
	const copyToken = async () => {
		try {
			if (typeof navigator.clipboard?.writeText !== "function") {
				setCopyResult(CopyResult.Manual);
				selectToken();
				return;
			}
			await navigator.clipboard.writeText(token);
			setCopyResult(CopyResult.Copied);
		} catch {
			setCopyResult(CopyResult.Manual);
			selectToken();
		}
	};

	return (
		<div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
			<p className="mb-2 text-sm font-medium text-amber-800 dark:text-amber-300">
				Token generated (save it now, it won't be shown again):
			</p>
			<div className="flex items-center gap-2">
				<input
					ref={input}
					aria-label="Generated token"
					readOnly
					value={token}
					onFocus={(event) => event.currentTarget.select()}
					className="min-w-0 flex-1 rounded bg-white px-3 py-2 font-mono text-sm dark:bg-zinc-900"
				/>
				<button
					type="button"
					aria-label="Copy token"
					onClick={() => void copyToken()}
					className="rounded-md p-2 hover:bg-amber-100 dark:hover:bg-amber-900"
				>
					<Copy className="h-4 w-4" />
				</button>
			</div>
			{copyResult === CopyResult.Copied && <p role="status">Token copied.</p>}
			{copyResult === CopyResult.Manual && (
				<div className="mt-2 text-sm text-amber-800 dark:text-amber-300">
					<p role="alert">
						Automatic copying is unavailable or was denied. Select the token and
						press Ctrl+C / Cmd+C, or use your device's copy action.
					</p>
					<button type="button" onClick={selectToken} className="underline">
						Select token for manual copy
					</button>
				</div>
			)}
			<button
				type="button"
				onClick={onDismiss}
				className="mt-2 text-xs text-amber-700 underline dark:text-amber-400"
			>
				Dismiss
			</button>
		</div>
	);
}
