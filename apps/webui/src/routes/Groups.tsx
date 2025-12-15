import { useGroups } from "@/api/groups";
import { GroupForm } from "@/components/groups/GroupForm";
import { GroupTable } from "@/components/groups/GroupTable";
import { Layout } from "@/components/layout/Layout";

export function GroupsPage() {
	const { data: groups = [], isLoading } = useGroups();

	return (
		<Layout>
			<div className="mx-auto max-w-screen-lg space-y-6">
				<h1 className="text-2xl font-semibold">Groups</h1>
				<GroupForm />
				{isLoading ? (
					<p className="text-sm text-zinc-500">Loading...</p>
				) : (
					<GroupTable groups={groups} />
				)}
			</div>
		</Layout>
	);
}
