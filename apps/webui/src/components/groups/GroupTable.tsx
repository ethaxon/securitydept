import { Trash2 } from "lucide-react";
import type { Group } from "@/api/groups";
import { useDeleteGroup } from "@/api/groups";

export function GroupTable({ groups }: { groups: Group[] }) {
	const deleteGroup = useDeleteGroup();

	if (groups.length === 0) {
		return (
			<p className="text-sm text-zinc-500 dark:text-zinc-400">
				No groups yet. Create one above.
			</p>
		);
	}

	return (
		<div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
			<table className="w-full text-sm">
				<thead className="bg-zinc-50 text-left text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
					<tr>
						<th className="px-4 py-3 font-medium">Name</th>
						<th className="px-4 py-3 font-medium">ID</th>
						<th className="px-4 py-3 font-medium w-16" />
					</tr>
				</thead>
				<tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
					{groups.map((group) => (
						<tr
							key={group.id}
							className="hover:bg-zinc-50 dark:hover:bg-zinc-900"
						>
							<td className="px-4 py-3 font-medium">{group.name}</td>
							<td className="px-4 py-3 font-mono text-xs text-zinc-500">
								{group.id}
							</td>
							<td className="px-4 py-3">
								<button
									type="button"
									onClick={() => deleteGroup.mutate(group.id)}
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
