import {
	aggregateWorkspaceReports,
	appsWebuiWorkspaceReport,
	type BrowserHarnessWorkspaceReport,
	describeBrowserAvailability,
	describeBrowserName,
	describeExecutionBaseline,
	HarnessBrowserName,
} from "@/lib/browserHarnessReport";

export interface BrowserHarnessSectionProps {
	additionalWorkspaceReports?: BrowserHarnessWorkspaceReport[];
}

export function BrowserHarnessSection({
	additionalWorkspaceReports = [],
}: BrowserHarnessSectionProps) {
	const currentReport = appsWebuiWorkspaceReport();
	const aggregated = aggregateWorkspaceReports([
		currentReport,
		...additionalWorkspaceReports,
	]);
	const webkitPolicy = currentReport.executionBaselinePolicy.find(
		(policy) => policy.browserName === HarnessBrowserName.Webkit,
	);

	return (
		<div
			className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
			data-testid="browser-harness-section"
		>
			<div className="mb-3 flex items-center justify-between">
				<h2 className="text-sm font-semibold">Browser Harness</h2>
				<span className="text-xs text-zinc-500 dark:text-zinc-400">
					Runtime projection of browser-owned auth-flow evidence
				</span>
			</div>
			<div className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
				Workspaces: {aggregated.workspaces.length} · Verified scenarios:{" "}
				{aggregated.totals.verifiedCount} · Blocked:{" "}
				{aggregated.totals.verifiedBlockedCount} · Unavailable:{" "}
				{aggregated.totals.verifiedUnavailableCount}
			</div>
			<div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
				<table className="w-full text-sm">
					<thead className="bg-zinc-50 text-left text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
						<tr>
							<th className="px-3 py-2 font-medium">Browser</th>
							<th className="px-3 py-2 font-medium">Availability</th>
							<th className="px-3 py-2 font-medium">Execution baseline</th>
							<th className="px-3 py-2 font-medium">Verified scenarios</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
						{currentReport.projects.map((project) => {
							const verified = currentReport.verifiedSummary.find(
								(v) => v.browserName === project.browserName,
							);
							return (
								<tr
									key={project.browserName}
									className="hover:bg-zinc-50 dark:hover:bg-zinc-900"
								>
									<td className="px-3 py-2 font-medium">
										{describeBrowserName(project.browserName)}
									</td>
									<td className="px-3 py-2">
										<span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
											{describeBrowserAvailability(project.availability)}
										</span>
									</td>
									<td className="px-3 py-2">
										<span className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
											{describeExecutionBaseline(project.executionBaseline)}
										</span>
									</td>
									<td className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
										{verified
											? `${verified.verifiedCount} verified · ${verified.blockedCount} blocked · ${verified.unavailableCount} unavailable`
											: "—"}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
			{webkitPolicy ? (
				<p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
					WebKit policy: {webkitPolicy.summary}
				</p>
			) : null}
		</div>
	);
}
