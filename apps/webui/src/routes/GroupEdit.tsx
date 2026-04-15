import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { AuthModeNotice } from "@/components/auth/AuthModeNotice";
import { GroupForm } from "@/components/groups/GroupForm";
import { Layout } from "@/components/layout/Layout";
import {
	useDashboardAccessNotice,
	useDashboardGroupQuery,
} from "@/hooks/useDashboardApi";

export function GroupEditPage() {
	const { groupId } = useParams({ from: "/groups/$groupId/edit" });
	const accessNotice = useDashboardAccessNotice();
	const { data: group, isLoading } = useDashboardGroupQuery(groupId);

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
