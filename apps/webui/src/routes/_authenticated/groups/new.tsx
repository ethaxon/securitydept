import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Layout } from "@/components/layout/Layout";
import { GroupForm } from "./-group-form";

export const Route = createFileRoute("/_authenticated/groups/new")({
	component: RouteComponent,
});

function RouteComponent() {
	return (
		<Layout>
			<div className="mx-auto max-w-5xl space-y-6">
				<div className="space-y-2">
					<Link
						to="/groups"
						className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
					>
						<ArrowLeft className="h-4 w-4" />
						Back to groups
					</Link>
					<h1 className="text-2xl font-semibold">Create Group</h1>
				</div>
				<GroupForm mode="create" />
			</div>
		</Layout>
	);
}
