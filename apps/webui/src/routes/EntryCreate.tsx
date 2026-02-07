import { Link, useSearch } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { EntryForm } from "@/components/entries/EntryForm";
import { Layout } from "@/components/layout/Layout";

export function EntryCreatePage() {
	const search = useSearch({ from: "/entries/new" });
	const formKey = `create:${JSON.stringify(search)}`;

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
					<h1 className="text-2xl font-semibold">Create Auth Entry</h1>
				</div>
				<EntryForm key={formKey} mode="create" initial={search} />
			</div>
		</Layout>
	);
}
