import { describe, expect, it } from "vitest";
import {
	aggregateWorkspaceReports,
	appsWebuiWorkspaceReport,
	BrowserAvailability,
	type BrowserHarnessWorkspaceReport,
	describeBrowserName,
	ExecutionBaseline,
	ExecutionBaselineRole,
	HarnessBrowserName,
	summarizeWorkspaceReport,
} from "../browserHarnessReport";

describe("browserHarnessReport", () => {
	it("appsWebuiWorkspaceReport publishes Chromium/Firefox/WebKit projects with the documented baselines", () => {
		const report = appsWebuiWorkspaceReport();
		expect(report.workspaceId).toBe("apps/webui");
		expect(report.projects).toHaveLength(3);

		const chromium = report.projects.find(
			(p) => p.browserName === HarnessBrowserName.Chromium,
		);
		const firefox = report.projects.find(
			(p) => p.browserName === HarnessBrowserName.Firefox,
		);
		const webkit = report.projects.find(
			(p) => p.browserName === HarnessBrowserName.Webkit,
		);

		expect(chromium?.executionBaseline).toBe(ExecutionBaseline.HostNative);
		expect(firefox?.executionBaseline).toBe(ExecutionBaseline.HostNative);
		expect(webkit?.executionBaseline).toBe(ExecutionBaseline.DistroboxHosted);

		const webkitPolicy = report.executionBaselinePolicy.find(
			(p) => p.browserName === HarnessBrowserName.Webkit,
		);
		expect(webkitPolicy?.hostNativeRole).toBe(ExecutionBaselineRole.HostTruth);
		expect(webkitPolicy?.distroboxHostedRole).toBe(
			ExecutionBaselineRole.CanonicalRecoveryPath,
		);
	});

	it("summarizeWorkspaceReport totals projection counts without depending on Playwright cache layout", () => {
		const summary = summarizeWorkspaceReport(appsWebuiWorkspaceReport());
		expect(summary.totals.availableCount).toBe(3);
		expect(summary.totals.blockedCount).toBe(0);
		expect(summary.totals.unavailableCount).toBe(0);
		expect(summary.totals.verifiedCount).toBe(30);
	});

	it("aggregateWorkspaceReports merges at least two synthetic workspace reports", () => {
		const syntheticOutpostsReport: BrowserHarnessWorkspaceReport = {
			workspaceId: "outposts/site-a",
			displayName: "outposts/site-a (synthetic)",
			projects: [
				{
					browserName: HarnessBrowserName.Chromium,
					availability: BrowserAvailability.Available,
					executionBaseline: ExecutionBaseline.HostNative,
				},
				{
					browserName: HarnessBrowserName.Webkit,
					availability: BrowserAvailability.Blocked,
					executionBaseline: ExecutionBaseline.HostNative,
				},
			],
			executionBaselinePolicy: [],
			verifiedSummary: [
				{
					browserName: HarnessBrowserName.Chromium,
					verifiedCount: 4,
					blockedCount: 0,
					unavailableCount: 0,
				},
				{
					browserName: HarnessBrowserName.Webkit,
					verifiedCount: 0,
					blockedCount: 4,
					unavailableCount: 0,
				},
			],
		};

		const aggregated = aggregateWorkspaceReports([
			appsWebuiWorkspaceReport(),
			syntheticOutpostsReport,
		]);

		expect(aggregated.workspaces.map((w) => w.workspaceId)).toEqual([
			"apps/webui",
			"outposts/site-a",
		]);
		expect(aggregated.totals.availableCount).toBe(4);
		expect(aggregated.totals.blockedCount).toBe(1);
		expect(aggregated.totals.verifiedCount).toBe(34);
		expect(aggregated.totals.verifiedBlockedCount).toBe(4);

		const chromium = aggregated.perBrowser.find(
			(p) => p.browserName === HarnessBrowserName.Chromium,
		);
		const webkit = aggregated.perBrowser.find(
			(p) => p.browserName === HarnessBrowserName.Webkit,
		);
		expect(chromium?.verifiedCount).toBe(14);
		expect(webkit?.verifiedCount).toBe(10);
		expect(webkit?.blockedCount).toBe(4);
	});

	it("describeBrowserName returns human labels for runtime UI", () => {
		expect(describeBrowserName(HarnessBrowserName.Chromium)).toBe("Chromium");
		expect(describeBrowserName(HarnessBrowserName.Firefox)).toBe("Firefox");
		expect(describeBrowserName(HarnessBrowserName.Webkit)).toBe("WebKit");
	});
});
