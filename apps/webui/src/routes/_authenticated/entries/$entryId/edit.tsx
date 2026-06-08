import {
	createFileRoute,
	Link,
	useParams,
	useSearch,
} from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Layout } from "@/components/layout/Layout";
import { useDashboardAccessNotice, useEntryQuery } from "@/dashboard/queries";
import { AuthModeNotice } from "@/routes/_authenticated/-auth-mode-notice";
import { EntryForm } from "../-entry-form";
import { parseEntrySearch } from "../-entry-search";

export const Route = createFileRoute("/_authenticated/entries/$entryId/edit")({
	component: RouteComponent,
	validateSearch: parseEntrySearch,
});

function RouteComponent() {
	const { entryId } = useParams({
		from: "/_authenticated/entries/$entryId/edit",
	});
	const search = useSearch({
		from: "/_authenticated/entries/$entryId/edit",
	});
	const accessNotice = useDashboardAccessNotice();
	const { data: entry, isLoading } = useEntryQuery(entryId);
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
