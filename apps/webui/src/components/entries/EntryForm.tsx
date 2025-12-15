import { Copy, KeyRound } from "lucide-react";
import { useState } from "react";
import {
	type CreateTokenResponse,
	useCreateBasicEntry,
	useCreateTokenEntry,
} from "@/api/entries";
import { useGroups } from "@/api/groups";

export function EntryForm() {
	const [kind, setKind] = useState<"basic" | "token">("basic");
	const [name, setName] = useState("");
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
	const [generatedToken, setGeneratedToken] = useState<string | null>(null);

	const { data: groups = [] } = useGroups();
	const createBasic = useCreateBasicEntry();
	const createToken = useCreateTokenEntry();

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (kind === "basic") {
			await createBasic.mutateAsync({
				name,
				username,
				password,
				groups: selectedGroups,
			});
		} else {
			const result: CreateTokenResponse = await createToken.mutateAsync({
				name,
				groups: selectedGroups,
			});
			setGeneratedToken(result.token);
		}
		setName("");
		setUsername("");
		setPassword("");
		setSelectedGroups([]);
	};

	const toggleGroup = (groupName: string) => {
		setSelectedGroups((prev) =>
			prev.includes(groupName)
				? prev.filter((g) => g !== groupName)
				: [...prev, groupName],
		);
	};

	return (
		<div className="space-y-4">
			<form onSubmit={handleSubmit} className="space-y-4">
				<div className="flex gap-2">
					<button
						type="button"
						onClick={() => setKind("basic")}
						className={`rounded-md px-3 py-1.5 text-sm font-medium ${kind === "basic" ? "bg-blue-600 text-white" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}
					>
						Basic Auth
					</button>
					<button
						type="button"
						onClick={() => setKind("token")}
						className={`rounded-md px-3 py-1.5 text-sm font-medium ${kind === "token" ? "bg-blue-600 text-white" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}
					>
						Token Auth
					</button>
				</div>

				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
					<input
						type="text"
						placeholder="Entry name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						required
						className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
					/>
					{kind === "basic" && (
						<>
							<input
								type="text"
								placeholder="Username"
								value={username}
								onChange={(e) => setUsername(e.target.value)}
								required
								className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
							/>
							<input
								type="password"
								placeholder="Password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								required
								className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
							/>
						</>
					)}
				</div>

				<div>
					<p className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
						Groups
					</p>
					<div className="flex flex-wrap gap-2">
						{groups.map((g) => (
							<button
								key={g.id}
								type="button"
								onClick={() => toggleGroup(g.name)}
								className={`rounded-md px-2.5 py-1 text-xs font-medium ${
									selectedGroups.includes(g.name)
										? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
										: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
								}`}
							>
								{g.name}
							</button>
						))}
						{groups.length === 0 && (
							<span className="text-xs text-zinc-400">
								No groups yet. Create groups first.
							</span>
						)}
					</div>
				</div>

				<button
					type="submit"
					disabled={createBasic.isPending || createToken.isPending}
					className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
				>
					<KeyRound className="h-4 w-4" />
					Create {kind === "basic" ? "Basic" : "Token"} Entry
				</button>
			</form>

			{generatedToken && (
				<div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
					<p className="mb-2 text-sm font-medium text-amber-800 dark:text-amber-300">
						Token generated (save it now, it won't be shown again):
					</p>
					<div className="flex items-center gap-2">
						<code className="flex-1 rounded bg-white px-3 py-2 text-sm break-all dark:bg-zinc-900">
							{generatedToken}
						</code>
						<button
							type="button"
							onClick={() => navigator.clipboard.writeText(generatedToken)}
							className="rounded-md p-2 hover:bg-amber-100 dark:hover:bg-amber-900"
						>
							<Copy className="h-4 w-4" />
						</button>
					</div>
					<button
						type="button"
						onClick={() => setGeneratedToken(null)}
						className="mt-2 text-xs text-amber-700 underline dark:text-amber-400"
					>
						Dismiss
					</button>
				</div>
			)}
		</div>
	);
}
