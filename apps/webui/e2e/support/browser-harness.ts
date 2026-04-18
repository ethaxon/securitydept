import { detectBrowserCapabilities } from "./browser-capability-detection.ts";
import { buildExecutionBaselinePolicy } from "./browser-execution-baseline-policy.ts";
import {
	type AuthFlowSuiteId as AuthFlowSuiteIdType,
	BrowserAvailability as BrowserAvailabilityValue,
	type BrowserExecutionBaselinePolicy,
	type BrowserHarnessReport,
	type ExecutionBaseline as ExecutionBaselineType,
	type HarnessBrowserName as HarnessBrowserNameType,
	type PlaywrightProjectCapability,
	type VerifiedEnvironmentScenario,
	type VerifiedScenarioId as VerifiedScenarioIdType,
} from "./browser-harness-contract.ts";
import { buildVerifiedEnvironment } from "./browser-harness-scenarios.ts";

export {
	AuthFlowSuiteId,
	BlockedReason,
	BrowserAvailability,
	DetectionSource,
	ExecutionBaseline,
	ExecutionBaselineRole,
	HarnessBrowserName,
	UnavailableReason,
	VerifiedPathKind,
	VerifiedScenarioId,
	VerifiedStatus,
} from "./browser-harness-contract.ts";

const projects = detectBrowserCapabilities();
const executionBaselinePolicy = buildExecutionBaselinePolicy();

export const browserHarnessReport: BrowserHarnessReport = {
	projects,
	executionBaselinePolicy,
	verifiedEnvironment: buildVerifiedEnvironment(projects),
};

export function getProjectCapability(
	browserName: HarnessBrowserNameType,
): PlaywrightProjectCapability | undefined {
	return browserHarnessReport.projects.find(
		(p) => p.browserName === browserName,
	);
}

export function getAvailableProjects(): PlaywrightProjectCapability[] {
	return browserHarnessReport.projects.filter(
		(p) => p.availability === BrowserAvailabilityValue.Available,
	);
}

export function getConfiguredProjects(options?: {
	includeBlocked?: boolean;
}): PlaywrightProjectCapability[] {
	return browserHarnessReport.projects.filter((project) => {
		if (project.availability === BrowserAvailabilityValue.Available) {
			return true;
		}
		return (
			options?.includeBlocked === true &&
			project.availability === BrowserAvailabilityValue.Blocked
		);
	});
}

export function getVerifiedScenario(
	scenarioId: VerifiedScenarioIdType,
	browserName: HarnessBrowserNameType,
): VerifiedEnvironmentScenario | undefined {
	return browserHarnessReport.verifiedEnvironment.find(
		(s) => s.scenarioId === scenarioId && s.browserName === browserName,
	);
}

export function getVerifiedScenariosForSuite(
	suiteId: AuthFlowSuiteIdType,
): VerifiedEnvironmentScenario[] {
	return browserHarnessReport.verifiedEnvironment.filter(
		(s) => s.suiteId === suiteId,
	);
}

export function getAvailableBrowserNames(): HarnessBrowserNameType[] {
	return browserHarnessReport.projects
		.filter((p) => p.availability === BrowserAvailabilityValue.Available)
		.map((p) => p.browserName);
}

export function getUnavailableBrowserNames(): HarnessBrowserNameType[] {
	return browserHarnessReport.projects
		.filter((p) => p.availability === BrowserAvailabilityValue.Unavailable)
		.map((p) => p.browserName);
}

export function getExecutionBaseline(
	browserName: HarnessBrowserNameType,
): ExecutionBaselineType | undefined {
	return getProjectCapability(browserName)?.executionBaseline;
}

export function getExecutionBaselinePolicy(
	browserName: HarnessBrowserNameType,
): BrowserExecutionBaselinePolicy | undefined {
	return browserHarnessReport.executionBaselinePolicy.find(
		(policy) => policy.browserName === browserName,
	);
}

export function getExecutionBaselinePolicies(): BrowserExecutionBaselinePolicy[] {
	return browserHarnessReport.executionBaselinePolicy;
}
