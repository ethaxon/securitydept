import { Link } from "@tanstack/react-router";
import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	useReactTable,
} from "@tanstack/react-table";
import { Pencil, Trash2 } from "lucide-react";
import { useMemo } from "react";
import type { Group } from "@/api/groups";
import { useDeleteGroup } from "@/api/groups";

export function GroupTable({ groups }: { groups: Group[] }) {
	const deleteGroup = useDeleteGroup();

	const columns = useMemo<ColumnDef<Group>[]>(
		() => [
			{
				header: "Name",
				accessorKey: "name",
				cell: ({ row }) => (
					<span className="font-medium">{row.original.name}</span>
				),
			},
			{
				header: "ID",
				accessorKey: "id",
				cell: ({ row }) => (
					<span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
						{row.original.id}
					</span>
				),
			},
			{
				header: "",
				id: "actions",
				cell: ({ row }) => (
					<div className="flex items-center gap-1">
						<Link
							to="/groups/$groupId/edit"
							params={{ groupId: row.original.id }}
							className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
						>
							<Pencil className="h-4 w-4" />
						</Link>
						<button
							type="button"
							onClick={() => deleteGroup.mutate(row.original.id)}
							className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
						>
							<Trash2 className="h-4 w-4" />
						</button>
					</div>
				),
			},
		],
		[deleteGroup],
	);

	const table = useReactTable({
		data: groups,
		columns,
		getCoreRowModel: getCoreRowModel(),
	});

	if (groups.length === 0) {
		return (
			<p className="text-sm text-zinc-500 dark:text-zinc-400">
				No groups yet. Use "New Group" to create one.
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
