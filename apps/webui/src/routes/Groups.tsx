import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useGroups } from "@/api/groups";
import { GroupTable } from "@/components/groups/GroupTable";
import { Layout } from "@/components/layout/Layout";

export function GroupsPage() {
	const { data: groups = [], isLoading } = useGroups();

	return (
		<Layout>
			<div className="mx-auto max-w-screen-lg space-y-6">
				<div className="flex items-center justify-between gap-3">
					<h1 className="text-2xl font-semibold">Groups</h1>
					<Link
						to="/groups/new"
						className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
					>
						<Plus className="h-4 w-4" />
						New Group
					</Link>
				</div>
				{isLoading ? (
					<p className="text-sm text-zinc-500">Loading...</p>
				) : (
					<GroupTable groups={groups} />
				)}
			</div>
		</Layout>
	);
}
