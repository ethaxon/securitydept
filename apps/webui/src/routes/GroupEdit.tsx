import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useGroup } from "@/api/groups";
import { GroupForm } from "@/components/groups/GroupForm";
import { Layout } from "@/components/layout/Layout";

export function GroupEditPage() {
	const { groupId } = useParams({ from: "/groups/$groupId/edit" });
	const { data: group, isLoading } = useGroup(groupId);

	return (
		<Layout>
			<div className="mx-auto max-w-screen-lg space-y-6">
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
