import {
	AuthFlowSuiteId,
	BlockedReason,
	BrowserAvailability,
	ExecutionBaseline,
	HarnessBrowserName,
	type HarnessBrowserName as HarnessBrowserNameType,
	type PlaywrightProjectCapability,
	UnavailableReason,
	type VerifiedEnvironmentScenario,
	VerifiedPathKind,
	VerifiedScenarioId,
	VerifiedStatus,
} from "./browser-harness-contract.ts";

interface ScenarioCatalogEntry {
	scenarioId: VerifiedScenarioId;
	suiteId: AuthFlowSuiteId;
	pathKind: VerifiedPathKind;
	harnessId?: string;
}

interface BrowserVerifiedClaim {
	scenarioId: VerifiedScenarioId;
	summary: string;
	requiredExecutionBaseline?: ExecutionBaseline;
}

const scenarioCatalog: readonly ScenarioCatalogEntry[] = [
	{
		scenarioId: VerifiedScenarioId.BasicAuthChallengeNoCachedCredentials,
		suiteId: AuthFlowSuiteId.BasicAuth,
		pathKind: VerifiedPathKind.BrowserNative,
	},
	{
		scenarioId: VerifiedScenarioId.BasicAuthLogoutAuthorizationHeaderHarness,
		suiteId: AuthFlowSuiteId.BasicAuth,
		pathKind: VerifiedPathKind.HarnessBacked,
		harnessId: "authorization-header-context",
	},
	{
		scenarioId: VerifiedScenarioId.FrontendOidcCallbackRedirect,
		suiteId: AuthFlowSuiteId.FrontendOidc,
		pathKind: VerifiedPathKind.BrowserNative,
	},
	{
		scenarioId: VerifiedScenarioId.FrontendOidcPopupRelay,
		suiteId: AuthFlowSuiteId.FrontendOidc,
		pathKind: VerifiedPathKind.BrowserNative,
	},
	{
		scenarioId: VerifiedScenarioId.FrontendOidcPopupClosedByUser,
		suiteId: AuthFlowSuiteId.FrontendOidc,
		pathKind: VerifiedPathKind.BrowserNative,
	},
	{
		scenarioId: VerifiedScenarioId.FrontendOidcCrossTabStorage,
		suiteId: AuthFlowSuiteId.FrontendOidc,
		pathKind: VerifiedPathKind.BrowserNative,
	},
	{
		scenarioId: VerifiedScenarioId.FrontendOidcCallbackDuplicateReplay,
		suiteId: AuthFlowSuiteId.FrontendOidc,
		pathKind: VerifiedPathKind.BrowserNative,
	},
	{
		scenarioId: VerifiedScenarioId.FrontendOidcCallbackUnknownState,
		suiteId: AuthFlowSuiteId.FrontendOidc,
		pathKind: VerifiedPathKind.BrowserNative,
	},
	{
		scenarioId: VerifiedScenarioId.FrontendOidcCallbackStaleState,
		suiteId: AuthFlowSuiteId.FrontendOidc,
		pathKind: VerifiedPathKind.BrowserNative,
	},
	{
		scenarioId: VerifiedScenarioId.FrontendOidcCallbackClientMismatch,
		suiteId: AuthFlowSuiteId.FrontendOidc,
		pathKind: VerifiedPathKind.BrowserNative,
	},
] as const;

const verifiedClaimsByBrowser = {
	[HarnessBrowserName.Chromium]: [
		{
			scenarioId: VerifiedScenarioId.BasicAuthChallengeNoCachedCredentials,
			summary:
				"Explicit /basic/login escalates into a browser auth error before page render; protected JSON stays plain unauthorized; /basic/logout returns plain 401 without WWW-Authenticate.",
		},
		{
			scenarioId: VerifiedScenarioId.BasicAuthLogoutAuthorizationHeaderHarness,
			summary:
				"Authorization-header harness reaches 200 before logout; /basic/logout remains plain 401 without challenge; subsequent probe stays authenticated because the harness continues to send credentials.",
		},
		{
			scenarioId: VerifiedScenarioId.FrontendOidcCallbackRedirect,
			summary:
				"Redirect callback returns to the frontend-mode playground through the real browser-owned host route.",
		},
		{
			scenarioId: VerifiedScenarioId.FrontendOidcPopupRelay,
			summary:
				"Popup login completes through the app-owned relay route inside the same browser host.",
		},
		{
			scenarioId: VerifiedScenarioId.FrontendOidcPopupClosedByUser,
			summary:
				"Popup closed by user surfaces a host-visible error with restart_flow recovery.",
		},
		{
			scenarioId: VerifiedScenarioId.FrontendOidcCrossTabStorage,
			summary:
				"Cross-tab hydrate/clear lifecycle is verified inside the browser-owned storage domain.",
		},
		{
			scenarioId: VerifiedScenarioId.FrontendOidcCallbackDuplicateReplay,
			summary:
				"Duplicate callback replay surfaces callback.duplicate_state with stable error code.",
		},
		{
			scenarioId: VerifiedScenarioId.FrontendOidcCallbackUnknownState,
			summary:
				"Unknown callback state surfaces callback.unknown_state with a restart path.",
		},
		{
			scenarioId: VerifiedScenarioId.FrontendOidcCallbackStaleState,
			summary:
				"Stale pending callback state surfaces callback.pending_stale with restart_flow recovery.",
		},
		{
			scenarioId: VerifiedScenarioId.FrontendOidcCallbackClientMismatch,
			summary:
				"Client-mismatch callback state surfaces callback.pending_client_mismatch.",
		},
	],
	[HarnessBrowserName.Firefox]: [
		{
			scenarioId: VerifiedScenarioId.FrontendOidcCallbackRedirect,
			summary:
				"Redirect callback returns to the frontend-mode playground through the real browser-owned host route under Firefox.",
		},
		{
			scenarioId: VerifiedScenarioId.FrontendOidcPopupRelay,
			summary:
				"Popup login completes through the app-owned relay route inside the same Firefox host.",
		},
		{
			scenarioId: VerifiedScenarioId.FrontendOidcPopupClosedByUser,
			summary:
				"Popup closed by user surfaces a host-visible error with restart_flow recovery under Firefox.",
		},
		{
			scenarioId: VerifiedScenarioId.FrontendOidcCrossTabStorage,
			summary:
				"Cross-tab hydrate/clear lifecycle is verified inside the browser-owned storage domain under Firefox.",
		},
		{
			scenarioId: VerifiedScenarioId.FrontendOidcCallbackDuplicateReplay,
			summary:
				"Duplicate callback replay surfaces callback.duplicate_state with stable error code under Firefox.",
		},
		{
			scenarioId: VerifiedScenarioId.FrontendOidcCallbackUnknownState,
			summary:
				"Unknown callback state surfaces callback.unknown_state with a restart path under Firefox.",
		},
		{
			scenarioId: VerifiedScenarioId.FrontendOidcCallbackStaleState,
			summary:
				"Stale pending callback state surfaces callback.pending_stale with restart_flow recovery under Firefox.",
		},
		{
			scenarioId: VerifiedScenarioId.FrontendOidcCallbackClientMismatch,
			summary:
				"Client-mismatch callback state surfaces callback.pending_client_mismatch under Firefox.",
		},
		{
			scenarioId: VerifiedScenarioId.BasicAuthChallengeNoCachedCredentials,
			summary:
				"Firefox Basic Auth no-cached-credentials path: explicit /basic/login challenge, protected JSON stays plain unauthorized, /basic/logout returns plain 401 without WWW-Authenticate.",
		},
		{
			scenarioId: VerifiedScenarioId.BasicAuthLogoutAuthorizationHeaderHarness,
			summary:
				"Authorization-header harness under Firefox reaches 200 before logout; /basic/logout remains plain 401 without challenge; subsequent probe stays authenticated because the harness continues to send credentials.",
		},
	],
	[HarnessBrowserName.Webkit]: [
		{
			scenarioId: VerifiedScenarioId.BasicAuthChallengeNoCachedCredentials,
			requiredExecutionBaseline: ExecutionBaseline.DistroboxHosted,
			summary:
				"Distrobox-hosted Ubuntu WebKit preserves the explicit /basic/login challenge as a committed 401 response with WWW-Authenticate, while protected JSON and /basic/logout remain plain unauthorized without a fresh challenge header.",
		},
		{
			scenarioId: VerifiedScenarioId.BasicAuthLogoutAuthorizationHeaderHarness,
			requiredExecutionBaseline: ExecutionBaseline.DistroboxHosted,
			summary:
				"Distrobox-hosted Ubuntu WebKit verifies the authorization-header harness path: protected backend access reaches 200 before logout, /basic/logout stays plain 401 without challenge, and the next protected probe remains authenticated because the harness keeps sending credentials.",
		},
		{
			scenarioId: VerifiedScenarioId.FrontendOidcCallbackRedirect,
			requiredExecutionBaseline: ExecutionBaseline.DistroboxHosted,
			summary:
				"Distrobox-hosted Ubuntu WebKit completes the real frontend-mode callback redirect through the browser-owned host route.",
		},
		{
			scenarioId: VerifiedScenarioId.FrontendOidcPopupRelay,
			requiredExecutionBaseline: ExecutionBaseline.DistroboxHosted,
			summary:
				"Distrobox-hosted Ubuntu WebKit completes popup login through the app-owned relay route inside the same browser host.",
		},
		{
			scenarioId: VerifiedScenarioId.FrontendOidcPopupClosedByUser,
			requiredExecutionBaseline: ExecutionBaseline.DistroboxHosted,
			summary:
				"Distrobox-hosted Ubuntu WebKit surfaces popup closed by user with the same host-visible restart_flow recovery path.",
		},
		{
			scenarioId: VerifiedScenarioId.FrontendOidcCrossTabStorage,
			requiredExecutionBaseline: ExecutionBaseline.DistroboxHosted,
			summary:
				"Distrobox-hosted Ubuntu WebKit verifies the cross-tab hydrate and clear lifecycle inside the same browser-owned storage domain.",
		},
		{
			scenarioId: VerifiedScenarioId.FrontendOidcCallbackDuplicateReplay,
			requiredExecutionBaseline: ExecutionBaseline.DistroboxHosted,
			summary:
				"Distrobox-hosted Ubuntu WebKit surfaces callback.duplicate_state after the first callback is consumed.",
		},
		{
			scenarioId: VerifiedScenarioId.FrontendOidcCallbackUnknownState,
			requiredExecutionBaseline: ExecutionBaseline.DistroboxHosted,
			summary:
				"Distrobox-hosted Ubuntu WebKit surfaces callback.unknown_state with a restart path.",
		},
		{
			scenarioId: VerifiedScenarioId.FrontendOidcCallbackStaleState,
			requiredExecutionBaseline: ExecutionBaseline.DistroboxHosted,
			summary:
				"Distrobox-hosted Ubuntu WebKit surfaces callback.pending_stale with restart_flow recovery.",
		},
		{
			scenarioId: VerifiedScenarioId.FrontendOidcCallbackClientMismatch,
			requiredExecutionBaseline: ExecutionBaseline.DistroboxHosted,
			summary:
				"Distrobox-hosted Ubuntu WebKit surfaces callback.pending_client_mismatch for another frontend-mode client.",
		},
	],
} as const satisfies Record<
	HarnessBrowserNameType,
	readonly BrowserVerifiedClaim[]
>;

function buildScenarioFromCatalog(
	browserName: HarnessBrowserNameType,
	entry: ScenarioCatalogEntry,
): Omit<VerifiedEnvironmentScenario, "status" | "summary"> {
	return {
		scenarioId: entry.scenarioId,
		suiteId: entry.suiteId,
		browserName,
		pathKind: entry.pathKind,
		harnessId: entry.harnessId,
	};
}

function claimApplies(
	claim: BrowserVerifiedClaim,
	capability: PlaywrightProjectCapability,
): boolean {
	return (
		claim.requiredExecutionBaseline === undefined ||
		claim.requiredExecutionBaseline === capability.executionBaseline
	);
}

export function buildVerifiedEnvironment(
	projects: PlaywrightProjectCapability[],
): VerifiedEnvironmentScenario[] {
	return projects.flatMap((capability) => {
		const claims = verifiedClaimsByBrowser[capability.browserName];
		const verifiedClaims = new Map(
			claims
				.filter((claim) => claimApplies(claim, capability))
				.map((claim) => [claim.scenarioId, claim]),
		);

		return scenarioCatalog.map((entry) => {
			const scenarioBase = buildScenarioFromCatalog(
				capability.browserName,
				entry,
			);
			const verifiedClaim = verifiedClaims.get(entry.scenarioId);

			if (
				capability.availability === BrowserAvailability.Available &&
				verifiedClaim
			) {
				return {
					...scenarioBase,
					status: VerifiedStatus.Verified,
					summary: verifiedClaim.summary,
				};
			}

			if (capability.availability === BrowserAvailability.Blocked) {
				return {
					...scenarioBase,
					status: VerifiedStatus.Blocked,
					blockedReason:
						capability.blockedReason ?? BlockedReason.HostDependenciesMissing,
					blockedDetails:
						capability.blockedDetails ?? "Missing host dependencies.",
					summary: `Blocked: ${capability.browserName} could not establish this scenario. ${capability.blockedDetails ?? "Missing host dependencies."}`,
				};
			}

			return {
				...scenarioBase,
				status: VerifiedStatus.Unavailable,
				unavailableReason: UnavailableReason.BrowserUnavailable,
				summary:
					capability.availability === BrowserAvailability.Unavailable
						? `Not verified: ${capability.browserName} is not available in the current Playwright harness.`
						: `Not verified: ${capability.browserName} does not yet have evidence for this scenario.`,
			};
		});
	});
}
