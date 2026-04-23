import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { AuthModeNotice } from "@/components/auth/AuthModeNotice";
import { EntryTable } from "@/components/entries/EntryTable";
import { Layout } from "@/components/layout/Layout";
import {
	useDashboardAccessNotice,
	useDashboardEntriesQuery,
	useDashboardGroupsQuery,
} from "@/hooks/useDashboardApi";

export function EntriesPage() {
	const accessNotice = useDashboardAccessNotice();
	const { data: entries = [], isLoading } = useDashboardEntriesQuery();
	const { data: groups = [] } = useDashboardGroupsQuery();

	return (
		<Layout>
			<div className="mx-auto max-w-5xl space-y-6">
				{accessNotice ? (
					<AuthModeNotice
						title={accessNotice.title}
						description={accessNotice.description}
					/>
				) : null}
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
