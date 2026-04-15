import { Link, useParams, useSearch } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { AuthModeNotice } from "@/components/auth/AuthModeNotice";
import { EntryForm } from "@/components/entries/EntryForm";
import { Layout } from "@/components/layout/Layout";
import {
	useDashboardAccessNotice,
	useDashboardEntryQuery,
} from "@/hooks/useDashboardApi";

export function EntryEditPage() {
	const { entryId } = useParams({ from: "/entries/$entryId/edit" });
	const search = useSearch({ from: "/entries/$entryId/edit" });
	const accessNotice = useDashboardAccessNotice();
	const { data: entry, isLoading } = useDashboardEntryQuery(entryId);
	const formKey = `edit:${entryId}:${JSON.stringify(search)}`;

	return (
		<Layout>
			<div className="mx-auto max-w-5xl space-y-6">
				{accessNotice ? (
					<AuthModeNotice
						title={accessNotice.title}
						description={accessNotice.description}
					/>
				) : null}
				<div className="space-y-2">
					<Link
						to="/entries"
						className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
					>
						<ArrowLeft className="h-4 w-4" />
						Back to entries
					</Link>
					<h1 className="text-2xl font-semibold">Edit Auth Entry</h1>
				</div>

				{isLoading ? (
					<p className="text-sm text-zinc-500 dark:text-zinc-400">Loading...</p>
				) : entry ? (
					<EntryForm key={formKey} mode="edit" entry={entry} initial={search} />
				) : (
					<p className="text-sm text-red-600 dark:text-red-400">
						Entry not found.
					</p>
				)}
			</div>
		</Layout>
	);
}
