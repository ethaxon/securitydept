import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Layout } from "@/components/layout/Layout";
import { EntryForm } from "./-entry-form";
import { parseEntrySearch } from "./-entry-search";

export const Route = createFileRoute("/_authenticated/entries/new")({
	component: RouteComponent,
	validateSearch: parseEntrySearch,
});

function RouteComponent() {
	const search = useSearch({ from: "/_authenticated/entries/new" });
	const formKey = `create:${JSON.stringify(search)}`;

	return (
		<Layout>
			<div className="mx-auto max-w-5xl space-y-6">
				<div className="space-y-2">
					<Link
						to="/entries"
						className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
					>
						<ArrowLeft className="h-4 w-4" />
						Back to entries
					</Link>
					<h1 className="text-2xl font-semibold">Create Auth Entry</h1>
				</div>
				<EntryForm key={formKey} mode="create" initial={search} />
			</div>
		</Layout>
	);
}
