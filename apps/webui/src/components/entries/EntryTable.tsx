import { Trash2 } from "lucide-react";
import type { AuthEntry } from "@/api/entries";
import { useDeleteEntry } from "@/api/entries";

export function EntryTable({ entries }: { entries: AuthEntry[] }) {
	const deleteEntry = useDeleteEntry();

	if (entries.length === 0) {
		return (
			<p className="text-sm text-zinc-500 dark:text-zinc-400">
				No auth entries yet. Create one above.
			</p>
		);
	}

	return (
		<div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
			<table className="w-full text-sm">
				<thead className="bg-zinc-50 text-left text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
					<tr>
						<th className="px-4 py-3 font-medium">Name</th>
						<th className="px-4 py-3 font-medium">Kind</th>
						<th className="px-4 py-3 font-medium">Username</th>
						<th className="px-4 py-3 font-medium">Groups</th>
						<th className="px-4 py-3 font-medium">Created</th>
						<th className="px-4 py-3 font-medium w-16" />
					</tr>
				</thead>
				<tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
					{entries.map((entry) => (
						<tr
							key={entry.id}
							className="hover:bg-zinc-50 dark:hover:bg-zinc-900"
						>
							<td className="px-4 py-3 font-medium">{entry.name}</td>
							<td className="px-4 py-3">
								<span
									className={
										entry.kind === "basic"
											? "inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400"
											: "inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
									}
								>
									{entry.kind}
								</span>
							</td>
							<td className="px-4 py-3 text-zinc-500">
								{entry.username || "—"}
							</td>
							<td className="px-4 py-3">
								<div className="flex flex-wrap gap-1">
									{entry.groups.map((g) => (
										<span
											key={g}
											className="inline-flex items-center rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800"
										>
											{g}
										</span>
									))}
								</div>
							</td>
							<td className="px-4 py-3 text-zinc-500">
								{new Date(entry.created_at).toLocaleDateString()}
							</td>
							<td className="px-4 py-3">
								<button
									type="button"
									onClick={() => deleteEntry.mutate(entry.id)}
									className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
								>
									<Trash2 className="h-4 w-4" />
								</button>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
