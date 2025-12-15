import { KeyRound, Shield, Users } from "lucide-react";
import { useEntries } from "@/api/entries";
import { useGroups } from "@/api/groups";
import { Layout } from "@/components/layout/Layout";

export function DashboardPage() {
	const { data: entries = [] } = useEntries();
	const { data: groups = [] } = useGroups();

	const basicCount = entries.filter((e) => e.kind === "basic").length;
	const tokenCount = entries.filter((e) => e.kind === "token").length;

	const stats = [
		{
			label: "Total Entries",
			value: entries.length,
			icon: KeyRound,
			color: "text-blue-600",
			bg: "bg-blue-50 dark:bg-blue-950",
		},
		{
			label: "Basic Auth",
			value: basicCount,
			icon: Shield,
			color: "text-green-600",
			bg: "bg-green-50 dark:bg-green-950",
		},
		{
			label: "Token Auth",
			value: tokenCount,
			icon: KeyRound,
			color: "text-purple-600",
			bg: "bg-purple-50 dark:bg-purple-950",
		},
		{
			label: "Groups",
			value: groups.length,
			icon: Users,
			color: "text-orange-600",
			bg: "bg-orange-50 dark:bg-orange-950",
		},
	];

	return (
		<Layout>
			<div className="mx-auto max-w-5xl space-y-6">
				<h1 className="text-2xl font-semibold">Dashboard</h1>
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{stats.map((stat) => (
						<div
							key={stat.label}
							className="flex items-center gap-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
						>
							<div className={`rounded-lg p-2.5 ${stat.bg}`}>
								<stat.icon className={`h-5 w-5 ${stat.color}`} />
							</div>
							<div>
								<p className="text-2xl font-semibold">{stat.value}</p>
								<p className="text-xs text-zinc-500 dark:text-zinc-400">
									{stat.label}
								</p>
							</div>
						</div>
					))}
				</div>
			</div>
		</Layout>
	);
}
