import { Link, useParams, useSearch } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useEntry } from "@/api/entries";
import { EntryForm } from "@/components/entries/EntryForm";
import { Layout } from "@/components/layout/Layout";

export function EntryEditPage() {
	const { entryId } = useParams({ from: "/entries/$entryId/edit" });
	const search = useSearch({ from: "/entries/$entryId/edit" });
	const { data: entry, isLoading } = useEntry(entryId);
	const formKey = `edit:${entryId}:${JSON.stringify(search)}`;

	return (
		<Layout>
			<div className="mx-auto max-w-screen-lg space-y-6">
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
