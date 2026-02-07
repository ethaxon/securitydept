import { KeyRound, Shield, Users } from "lucide-react";
import { useEntries } from "@/api/entries";
import { useGroups } from "@/api/groups";
import { useServerHealth } from "@/api/serverHealth";
import { Layout } from "@/components/layout/Layout";

export function DashboardPage() {
	const { data: entries = [] } = useEntries();
	const { data: groups = [] } = useGroups();
	const {
		data: serverHealth,
		isLoading: isHealthLoading,
		isError: isHealthError,
	} = useServerHealth();

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
				<div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
					<div className="mb-3 flex items-center justify-between">
						<h2 className="text-sm font-semibold">Available APIs</h2>
						<span className="text-xs text-zinc-500 dark:text-zinc-400">
							Auto-refresh every 5s
						</span>
					</div>
					<div className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
						Server status:{" "}
						{isHealthLoading
							? "Checking..."
							: isHealthError
								? "DOWN"
								: `${serverHealth?.status ?? "unknown"} (${serverHealth?.service ?? "unknown"})`}
					</div>
					<div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
						<table className="w-full text-sm">
							<thead className="bg-zinc-50 text-left text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
								<tr>
									<th className="px-3 py-2 font-medium">Method</th>
									<th className="px-3 py-2 font-medium">Path</th>
									<th className="px-3 py-2 font-medium">Auth</th>
									<th className="px-3 py-2 font-medium">Description</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
								{(serverHealth?.apis ?? []).map((item) => (
									<tr
										key={`${item.method}:${item.path}:${item.description}`}
										className="hover:bg-zinc-50 dark:hover:bg-zinc-900"
									>
										<td className="px-3 py-2 font-mono text-xs">
											{item.method}
										</td>
										<td className="px-3 py-2 font-mono text-xs text-zinc-500 dark:text-zinc-400">
											{item.path}
										</td>
										<td className="px-3 py-2">
											{item.auth_required ? (
												<span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
													Required
												</span>
											) : (
												<span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">
													Public
												</span>
											)}
										</td>
										<td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">
											{item.description}
										</td>
									</tr>
								))}
								{!isHealthLoading &&
									(serverHealth?.apis ?? []).length === 0 && (
										<tr>
											<td
												className="px-3 py-3 text-zinc-500 dark:text-zinc-400"
												colSpan={4}
											>
												No API metadata returned.
											</td>
										</tr>
									)}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</Layout>
	);
}
