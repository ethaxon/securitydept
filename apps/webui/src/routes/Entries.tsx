import { useEntries } from "@/api/entries";
import { EntryForm } from "@/components/entries/EntryForm";
import { EntryTable } from "@/components/entries/EntryTable";
import { Layout } from "@/components/layout/Layout";

export function EntriesPage() {
	const { data: entries = [], isLoading } = useEntries();

	return (
		<Layout>
			<div className="mx-auto max-w-screen-lg space-y-6">
				<h1 className="text-2xl font-semibold">Auth Entries</h1>
				<EntryForm />
				{isLoading ? (
					<p className="text-sm text-zinc-500">Loading...</p>
				) : (
					<EntryTable entries={entries} />
				)}
			</div>
		</Layout>
	);
}
