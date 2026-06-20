import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Layout } from "@/components/layout/Layout";
import { useGroupQuery } from "@/dashboard/queries";
import { GroupForm } from "../-group-form";

export const Route = createFileRoute("/_authenticated/groups/$groupId/edit")({
	component: RouteComponent,
});

function RouteComponent() {
	const { groupId } = useParams({
		from: "/_authenticated/groups/$groupId/edit",
	});
	const { data: group, isLoading } = useGroupQuery(groupId);

	return (
		<Layout authenticated>
			<div className="mx-auto max-w-5xl space-y-6">
				<div className="space-y-2">
					<Link
						to="/groups"
						className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
					>
						<ArrowLeft className="h-4 w-4" />
						Back to groups
					</Link>
					<h1 className="text-2xl font-semibold">Edit Group</h1>
				</div>

				{isLoading ? (
					<p className="text-sm text-zinc-500 dark:text-zinc-400">Loading...</p>
				) : group ? (
					<GroupForm mode="edit" group={group} />
				) : (
					<p className="text-sm text-red-600 dark:text-red-400">
						Group not found.
					</p>
				)}
			</div>
		</Layout>
	);
}
