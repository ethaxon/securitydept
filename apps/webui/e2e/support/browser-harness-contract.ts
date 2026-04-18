export const HarnessBrowserName = {
	Chromium: "chromium",
	Firefox: "firefox",
	Webkit: "webkit",
} as const;
export type HarnessBrowserName =
	(typeof HarnessBrowserName)[keyof typeof HarnessBrowserName];

export const VerifiedPathKind = {
	BrowserNative: "browser-native",
	HarnessBacked: "harness-backed",
} as const;
export type VerifiedPathKind =
	(typeof VerifiedPathKind)[keyof typeof VerifiedPathKind];

export const BrowserAvailability = {
	Available: "available",
	Blocked: "blocked",
	Unavailable: "unavailable",
} as const;
export type BrowserAvailability =
	(typeof BrowserAvailability)[keyof typeof BrowserAvailability];

export const UnavailableReason = {
	ExecutableNotDetected: "executable-not-detected",
	ProjectNotConfigured: "project-not-configured",
	BrowserUnavailable: "browser-unavailable",
} as const;
export type UnavailableReason =
	(typeof UnavailableReason)[keyof typeof UnavailableReason];

export const DetectionSource = {
	SystemExecutable: "system-executable",
	PlaywrightManaged: "playwright-managed",
} as const;
export type DetectionSource =
	(typeof DetectionSource)[keyof typeof DetectionSource];

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

export const BlockedReason = {
	HostDependenciesMissing: "host-dependencies-missing",
} as const;
export type BlockedReason = (typeof BlockedReason)[keyof typeof BlockedReason];

export interface PlaywrightProjectCapability {
	browserName: HarnessBrowserName;
	availability: BrowserAvailability;
	executionBaseline: ExecutionBaseline;
	executablePath?: string;
	detectionSource?: DetectionSource;
	blockedReason?: BlockedReason;
	blockedDetails?: string;
	unavailableReason?: UnavailableReason;
}

export interface BrowserExecutionBaselinePolicySurface {
	executionBaseline: ExecutionBaseline;
	role: ExecutionBaselineRole;
	summary: string;
}

export interface BrowserExecutionBaselinePolicy {
	browserName: HarnessBrowserName;
	preferredExecutionBaseline: ExecutionBaseline;
	hostNative: BrowserExecutionBaselinePolicySurface;
	distroboxHosted: BrowserExecutionBaselinePolicySurface;
	summary: string;
}

export const VerifiedScenarioId = {
	BasicAuthChallengeNoCachedCredentials:
		"basic-auth.challenge.no-cached-credentials",
	BasicAuthLogoutAuthorizationHeaderHarness:
		"basic-auth.logout.authorization-header-harness",
	FrontendOidcCallbackRedirect: "frontend-oidc.callback.redirect",
	FrontendOidcPopupRelay: "frontend-oidc.popup.relay",
	FrontendOidcPopupClosedByUser: "frontend-oidc.popup.closed-by-user",
	FrontendOidcCrossTabStorage: "frontend-oidc.cross-tab.storage",
	FrontendOidcCallbackDuplicateReplay:
		"frontend-oidc.callback.duplicate-replay",
	FrontendOidcCallbackUnknownState: "frontend-oidc.callback.unknown-state",
	FrontendOidcCallbackStaleState: "frontend-oidc.callback.stale-state",
	FrontendOidcCallbackClientMismatch: "frontend-oidc.callback.client-mismatch",
} as const;
export type VerifiedScenarioId =
	(typeof VerifiedScenarioId)[keyof typeof VerifiedScenarioId];

export const AuthFlowSuiteId = {
	BasicAuth: "basic-auth",
	FrontendOidc: "frontend-oidc",
} as const;
export type AuthFlowSuiteId =
	(typeof AuthFlowSuiteId)[keyof typeof AuthFlowSuiteId];

export const VerifiedStatus = {
	Verified: "verified",
	Blocked: "blocked",
	Unavailable: "unavailable",
} as const;
export type VerifiedStatus =
	(typeof VerifiedStatus)[keyof typeof VerifiedStatus];

export interface VerifiedEnvironmentScenario {
	scenarioId: VerifiedScenarioId;
	suiteId: AuthFlowSuiteId;
	browserName: HarnessBrowserName;
	pathKind: VerifiedPathKind;
	status: VerifiedStatus;
	harnessId?: string;
	blockedReason?: BlockedReason;
	blockedDetails?: string;
	unavailableReason?: typeof UnavailableReason.BrowserUnavailable;
	summary: string;
}

export interface BrowserHarnessReport {
	projects: PlaywrightProjectCapability[];
	executionBaselinePolicy: BrowserExecutionBaselinePolicy[];
	verifiedEnvironment: VerifiedEnvironmentScenario[];
}
