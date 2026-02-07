import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useEntries } from "@/api/entries";
import { useGroups } from "@/api/groups";
import { EntryTable } from "@/components/entries/EntryTable";
import { Layout } from "@/components/layout/Layout";

export function EntriesPage() {
	const { data: entries = [], isLoading } = useEntries();
	const { data: groups = [] } = useGroups();

	return (
		<Layout>
			<div className="mx-auto max-w-screen-lg space-y-6">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<h1 className="text-2xl font-semibold">Auth Entries</h1>
					<Link
						to="/entries/new"
						className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 sm:w-auto"
					>
						<Plus className="h-4 w-4" />
						New Entry
					</Link>
				</div>
				{isLoading ? (
					<p className="text-sm text-zinc-500">Loading...</p>
				) : (
					<EntryTable entries={entries} groups={groups} />
				)}
			</div>
		</Layout>
	);
}
