import { Link } from "@tanstack/react-router";
import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	useReactTable,
} from "@tanstack/react-table";
import { Pencil, Trash2 } from "lucide-react";
import { useMemo } from "react";
import type { AuthEntry } from "@/api/entries";
import { useDeleteEntry } from "@/api/entries";
import type { Group } from "@/api/groups";

export function EntryTable({
	entries,
	groups,
}: {
	entries: AuthEntry[];
	groups: Group[];
}) {
	const deleteEntry = useDeleteEntry();
	const groupNameById = useMemo(
		() => new Map(groups.map((group) => [group.id, group.name])),
		[groups],
	);

	const columns = useMemo<ColumnDef<AuthEntry>[]>(
		() => [
			{
				header: "Name",
				accessorKey: "name",
				cell: ({ row }) => (
					<span className="font-medium">{row.original.name}</span>
				),
			},
			{
				header: "Kind",
				accessorKey: "kind",
				cell: ({ row }) => (
					<span
						className={
							row.original.kind === "basic"
								? "inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400"
								: "inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
						}
					>
						{row.original.kind}
					</span>
				),
			},
			{
				header: "Username",
				accessorKey: "username",
				cell: ({ row }) => (
					<span className="text-zinc-500 dark:text-zinc-400">
						{row.original.username || "—"}
					</span>
				),
			},
			{
				header: "Groups",
				id: "groups",
				cell: ({ row }) => (
					<div className="flex flex-wrap gap-1">
						{row.original.group_ids.map((groupId) => (
							<span
								key={groupId}
								className="inline-flex items-center rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800"
							>
								{groupNameById.get(groupId) ?? groupId}
							</span>
						))}
					</div>
				),
			},
			{
				header: "Created",
				accessorKey: "created_at",
				cell: ({ row }) => (
					<span className="text-zinc-500 dark:text-zinc-400">
						{new Date(row.original.created_at).toLocaleDateString()}
					</span>
				),
			},
			{
				header: "",
				id: "actions",
				cell: ({ row }) => (
					<div className="flex items-center gap-1">
						<Link
							to="/entries/$entryId/edit"
							params={{ entryId: row.original.id }}
							className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
						>
							<Pencil className="h-4 w-4" />
						</Link>
						<button
							type="button"
							onClick={() => deleteEntry.mutate(row.original.id)}
							className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
						>
							<Trash2 className="h-4 w-4" />
						</button>
					</div>
				),
			},
		],
		[deleteEntry, groupNameById],
	);

	const table = useReactTable({
		data: entries,
		columns,
		getCoreRowModel: getCoreRowModel(),
	});

	if (entries.length === 0) {
		return (
			<p className="text-sm text-zinc-500 dark:text-zinc-400">
				No auth entries yet. Use "New Entry" to create one.
			</p>
		);
	}

	return (
		<div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
			<table className="w-full text-sm">
				<thead className="bg-zinc-50 text-left text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
					{table.getHeaderGroups().map((headerGroup) => (
						<tr key={headerGroup.id}>
							{headerGroup.headers.map((header) => (
								<th key={header.id} className="px-4 py-3 font-medium">
									{header.isPlaceholder
										? null
										: flexRender(
												header.column.columnDef.header,
												header.getContext(),
											)}
								</th>
							))}
						</tr>
					))}
				</thead>
				<tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
					{table.getRowModel().rows.map((row) => (
						<tr
							key={row.id}
							className="hover:bg-zinc-50 dark:hover:bg-zinc-900"
						>
							{row.getVisibleCells().map((cell) => (
								<td key={cell.id} className="px-4 py-3 align-top">
									{flexRender(cell.column.columnDef.cell, cell.getContext())}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
