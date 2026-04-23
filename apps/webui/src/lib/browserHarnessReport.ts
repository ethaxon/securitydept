// Iteration 149 (Task Pack C): runtime-safe browser harness report model.
//
// This module is the runtime-side authority for "what browser-owned auth-flow
// evidence does this workspace currently publish". It is intentionally:
//
// - free of any Node / Playwright import, so the bundled webui can import
//   it without dragging the e2e harness Node deps into the browser bundle,
// - workspace-shaped, so a future cross-repo aggregator (e.g. an `outposts`
//   workspace report being merged with this `apps/webui` report) can be
//   composed by `aggregateWorkspaceReports([...])` without changing the
//   per-workspace contract,
// - decoupled from the live Playwright detection layer in
//   `apps/webui/e2e/support/browser-harness*`. The e2e support files remain
//   the system-of-record when actually executing Playwright; this file is
//   the system-of-record when *displaying* the report inside webui.
//
// What this module is NOT:
// - a cross-repo browser automation platform,
// - a Playwright cache scanner,
// - a generic OpenAPI / capability schema.

export const HarnessBrowserName = {
	Chromium: "chromium",
	Firefox: "firefox",
	Webkit: "webkit",
} as const;
export type HarnessBrowserName =
	(typeof HarnessBrowserName)[keyof typeof HarnessBrowserName];

export const BrowserAvailability = {
	Available: "available",
	Blocked: "blocked",
	Unavailable: "unavailable",
} as const;
export type BrowserAvailability =
	(typeof BrowserAvailability)[keyof typeof BrowserAvailability];

export const ExecutionBaseline = {
	HostNative: "host-native",
	DistroboxHosted: "distrobox-hosted",
} as const;
export type ExecutionBaseline =
	(typeof ExecutionBaseline)[keyof typeof ExecutionBaseline];

export const ExecutionBaselineRole = {
	PrimaryAuthority: "primary-authority",
	HostTruth: "host-truth",
	CanonicalRecoveryPath: "canonical-recovery-path",
	NotAdopted: "not-adopted",
} as const;
export type ExecutionBaselineRole =
	(typeof ExecutionBaselineRole)[keyof typeof ExecutionBaselineRole];

export const VerifiedStatus = {
	Verified: "verified",
	Blocked: "blocked",
	Unavailable: "unavailable",
} as const;
export type VerifiedStatus =
	(typeof VerifiedStatus)[keyof typeof VerifiedStatus];

export interface BrowserProjectCapability {
	browserName: HarnessBrowserName;
	availability: BrowserAvailability;
	executionBaseline: ExecutionBaseline;
}

export interface BrowserExecutionBaselinePolicySummary {
	browserName: HarnessBrowserName;
	preferredExecutionBaseline: ExecutionBaseline;
	hostNativeRole: ExecutionBaselineRole;
	distroboxHostedRole: ExecutionBaselineRole;
	summary: string;
}

export interface VerifiedScenarioSummary {
	browserName: HarnessBrowserName;
	verifiedCount: number;
	blockedCount: number;
	unavailableCount: number;
}

export interface BrowserHarnessWorkspaceReport {
	workspaceId: string;
	displayName: string;
	projects: BrowserProjectCapability[];
	executionBaselinePolicy: BrowserExecutionBaselinePolicySummary[];
	verifiedSummary: VerifiedScenarioSummary[];
}

export interface BrowserHarnessWorkspaceTotals {
	availableCount: number;
	blockedCount: number;
	unavailableCount: number;
	verifiedCount: number;
	verifiedBlockedCount: number;
	verifiedUnavailableCount: number;
}

export interface BrowserHarnessWorkspaceReportSummary {
	workspaceId: string;
	displayName: string;
	totals: BrowserHarnessWorkspaceTotals;
}

export interface BrowserHarnessAggregatedReport {
	workspaces: BrowserHarnessWorkspaceReportSummary[];
	totals: BrowserHarnessWorkspaceTotals;
	perBrowser: Array<{
		browserName: HarnessBrowserName;
		verifiedCount: number;
		blockedCount: number;
		unavailableCount: number;
	}>;
}

// Static facts published by `apps/webui` for the current verified harness
// matrix. Source-of-truth alignment is enforced by the e2e support harness
// at `apps/webui/e2e/support/browser-harness-scenarios.ts` (Chromium /
// Firefox / WebKit each publish 10 verified scenarios; WebKit only when
// running under the distrobox-hosted execution baseline).
const APPS_WEBUI_VERIFIED_SUMMARY: VerifiedScenarioSummary[] = [
	{
		browserName: HarnessBrowserName.Chromium,
		verifiedCount: 10,
		blockedCount: 0,
		unavailableCount: 0,
	},
	{
		browserName: HarnessBrowserName.Firefox,
		verifiedCount: 10,
		blockedCount: 0,
		unavailableCount: 0,
	},
	{
		browserName: HarnessBrowserName.Webkit,
		verifiedCount: 10,
		blockedCount: 0,
		unavailableCount: 0,
	},
];

const APPS_WEBUI_EXECUTION_BASELINE_POLICY: BrowserExecutionBaselinePolicySummary[] =
	[
		{
			browserName: HarnessBrowserName.Chromium,
			preferredExecutionBaseline: ExecutionBaseline.HostNative,
			hostNativeRole: ExecutionBaselineRole.PrimaryAuthority,
			distroboxHostedRole: ExecutionBaselineRole.NotAdopted,
			summary:
				"Host-native Chromium remains the primary authority; distrobox-hosted execution is not the formal policy target.",
		},
		{
			browserName: HarnessBrowserName.Firefox,
			preferredExecutionBaseline: ExecutionBaseline.HostNative,
			hostNativeRole: ExecutionBaselineRole.PrimaryAuthority,
			distroboxHostedRole: ExecutionBaselineRole.NotAdopted,
			summary:
				"Host-native Firefox remains the primary authority; distrobox-hosted execution is not the formal policy target.",
		},
		{
			browserName: HarnessBrowserName.Webkit,
			preferredExecutionBaseline: ExecutionBaseline.DistroboxHosted,
			hostNativeRole: ExecutionBaselineRole.HostTruth,
			distroboxHostedRole: ExecutionBaselineRole.CanonicalRecoveryPath,
			summary:
				"WebKit host-native records host bring-up truth (may be blocked on non-Debian/Ubuntu hosts); distrobox-hosted Ubuntu is the canonical recovery path with the full 10-scenario verified matrix.",
		},
	];

/**
 * Static workspace report describing the current `apps/webui` browser-owned
 * auth-flow evidence as published by the e2e support harness. The runtime
 * webui ships this projection so the Dashboard can render a deterministic
 * report without depending on Playwright cache layout or Node-only runtime.
 */
export function appsWebuiWorkspaceReport(): BrowserHarnessWorkspaceReport {
	return {
		workspaceId: "apps/webui",
		displayName: "apps/webui (current workspace)",
		projects: [
			{
				browserName: HarnessBrowserName.Chromium,
				availability: BrowserAvailability.Available,
				executionBaseline: ExecutionBaseline.HostNative,
			},
			{
				browserName: HarnessBrowserName.Firefox,
				availability: BrowserAvailability.Available,
				executionBaseline: ExecutionBaseline.HostNative,
			},
			{
				browserName: HarnessBrowserName.Webkit,
				availability: BrowserAvailability.Available,
				executionBaseline: ExecutionBaseline.DistroboxHosted,
			},
		],
		executionBaselinePolicy: APPS_WEBUI_EXECUTION_BASELINE_POLICY,
		verifiedSummary: APPS_WEBUI_VERIFIED_SUMMARY,
	};
}

function emptyTotals(): BrowserHarnessWorkspaceTotals {
	return {
		availableCount: 0,
		blockedCount: 0,
		unavailableCount: 0,
		verifiedCount: 0,
		verifiedBlockedCount: 0,
		verifiedUnavailableCount: 0,
	};
}

export function summarizeWorkspaceReport(
	report: BrowserHarnessWorkspaceReport,
): BrowserHarnessWorkspaceReportSummary {
	const totals = emptyTotals();
	for (const project of report.projects) {
		if (project.availability === BrowserAvailability.Available) {
			totals.availableCount += 1;
		} else if (project.availability === BrowserAvailability.Blocked) {
			totals.blockedCount += 1;
		} else {
			totals.unavailableCount += 1;
		}
	}
	for (const verified of report.verifiedSummary) {
		totals.verifiedCount += verified.verifiedCount;
		totals.verifiedBlockedCount += verified.blockedCount;
		totals.verifiedUnavailableCount += verified.unavailableCount;
	}
	return {
		workspaceId: report.workspaceId,
		displayName: report.displayName,
		totals,
	};
}

/**
 * Aggregate any number of synthetic workspace reports into a single
 * cross-workspace summary. Iteration 149 only ships a single live workspace
 * (`apps/webui`); this aggregator exists so a future `outposts` (or any
 * additional repo-local) workspace report can be merged without changing
 * the per-workspace contract.
 */
export function aggregateWorkspaceReports(
	reports: BrowserHarnessWorkspaceReport[],
): BrowserHarnessAggregatedReport {
	const workspaces = reports.map(summarizeWorkspaceReport);
	const totals = emptyTotals();
	for (const summary of workspaces) {
		totals.availableCount += summary.totals.availableCount;
		totals.blockedCount += summary.totals.blockedCount;
		totals.unavailableCount += summary.totals.unavailableCount;
		totals.verifiedCount += summary.totals.verifiedCount;
		totals.verifiedBlockedCount += summary.totals.verifiedBlockedCount;
		totals.verifiedUnavailableCount += summary.totals.verifiedUnavailableCount;
	}

	const perBrowserMap = new Map<
		HarnessBrowserName,
		{
			browserName: HarnessBrowserName;
			verifiedCount: number;
			blockedCount: number;
			unavailableCount: number;
		}
	>();
	for (const report of reports) {
		for (const verified of report.verifiedSummary) {
			const existing = perBrowserMap.get(verified.browserName) ?? {
				browserName: verified.browserName,
				verifiedCount: 0,
				blockedCount: 0,
				unavailableCount: 0,
			};
			existing.verifiedCount += verified.verifiedCount;
			existing.blockedCount += verified.blockedCount;
			existing.unavailableCount += verified.unavailableCount;
			perBrowserMap.set(verified.browserName, existing);
		}
	}

	return {
		workspaces,
		totals,
		perBrowser: Array.from(perBrowserMap.values()),
	};
}

export function describeBrowserAvailability(
	availability: BrowserAvailability,
): string {
	switch (availability) {
		case BrowserAvailability.Available:
			return "Available";
		case BrowserAvailability.Blocked:
			return "Blocked";
		case BrowserAvailability.Unavailable:
			return "Unavailable";
	}
}

export function describeExecutionBaseline(baseline: ExecutionBaseline): string {
	switch (baseline) {
		case ExecutionBaseline.HostNative:
			return "Host-native";
		case ExecutionBaseline.DistroboxHosted:
			return "Distrobox-hosted";
	}
}

export function describeBrowserName(name: HarnessBrowserName): string {
	switch (name) {
		case HarnessBrowserName.Chromium:
			return "Chromium";
		case HarnessBrowserName.Firefox:
			return "Firefox";
		case HarnessBrowserName.Webkit:
			return "WebKit";
	}
}
