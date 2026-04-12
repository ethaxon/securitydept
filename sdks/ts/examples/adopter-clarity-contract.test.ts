/// <reference types="node" />

// This guardrail ensures that the evidence files backing the verified-environment,
// promotion-readiness, and adopter-checklist claims in docs/007-CLIENT_SDK_GUIDE
// stay intact.
// It does not assert content — only existence. If any file is removed, this test
// fails and forces an explicit update to both the guardrail and the documentation.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const tsWorkspaceRoot = path.resolve(import.meta.dirname, "../");

const EvidenceSemanticLayer = {
	VerifiedEnvironments: "verified-environments",
	PromotionReadiness: "promotion-readiness",
	MinimalEntry: "minimal-entry",
} as const;

type EvidenceSemanticLayer =
	(typeof EvidenceSemanticLayer)[keyof typeof EvidenceSemanticLayer];

interface EvidenceFileMapping {
	path: string;
	layers: EvidenceSemanticLayer[];
}

// Some evidence files intentionally back multiple doc semantics at once.
// We model that overlap explicitly here so reviewers can see the intended
// relationship instead of inferring it from scattered arrays.
const EVIDENCE_FILE_MAPPINGS: EvidenceFileMapping[] = [
	{
		path: "examples/minimal-entry-points.test.ts",
		layers: [
			EvidenceSemanticLayer.VerifiedEnvironments,
			EvidenceSemanticLayer.MinimalEntry,
		],
	},
	{
		path: "packages/token-set-context-client/src/backend-oidc-mode/__tests__/web.test.ts",
		layers: [
			EvidenceSemanticLayer.VerifiedEnvironments,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		path: "packages/token-set-context-client-react/src/__tests__/adapter.test.ts",
		layers: [
			EvidenceSemanticLayer.VerifiedEnvironments,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		// Standalone minimal-entry example for backend-oidc-mode/react.
		// Proves provider wiring, convenience hook consumption, and
		// full context hook usage from React.
		path: "examples/backend-oidc-react-minimal-entry.test.ts",
		layers: [
			EvidenceSemanticLayer.MinimalEntry,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		path: "examples/backend-oidc-mode-browser-scenario.test.ts",
		layers: [EvidenceSemanticLayer.VerifiedEnvironments],
	},
	{
		// Standalone minimal-entry example for backend-oidc-mode/web.
		// Proves browser client creation, bootstrap, authorize URL,
		// and SSR restoreState alternative.
		path: "examples/backend-oidc-web-minimal-entry.test.ts",
		layers: [
			EvidenceSemanticLayer.MinimalEntry,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		// Standalone minimal-entry example for backend-oidc-mode root subpath.
		// Proves direct client construction, restoreState, authorizationHeader,
		// and callback fragment parser from the platform-neutral root import.
		path: "examples/backend-oidc-mode-minimal-entry.test.ts",
		layers: [
			EvidenceSemanticLayer.MinimalEntry,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		path: "examples/basic-auth-guard-scenario.test.ts",
		layers: [
			EvidenceSemanticLayer.VerifiedEnvironments,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		path: "examples/session-context-scenario.test.ts",
		layers: [EvidenceSemanticLayer.VerifiedEnvironments],
	},
	{
		path: "packages/basic-auth-context-client/src/web/__tests__/adapter.test.ts",
		layers: [EvidenceSemanticLayer.PromotionReadiness],
	},
	{
		path: "packages/basic-auth-context-client/src/__tests__/client.test.ts",
		layers: [EvidenceSemanticLayer.PromotionReadiness],
	},
	{
		path: "packages/basic-auth-context-client-react/src/__tests__/adapter.test.ts",
		layers: [EvidenceSemanticLayer.PromotionReadiness],
	},
	{
		path: "packages/session-context-client-react/src/__tests__/adapter.test.ts",
		layers: [EvidenceSemanticLayer.PromotionReadiness],
	},
	{
		path: "examples/session-context-react-minimal-entry.test.ts",
		layers: [
			EvidenceSemanticLayer.PromotionReadiness,
			EvidenceSemanticLayer.MinimalEntry,
		],
	},
	{
		path: "examples/basic-auth-web-minimal-entry.test.ts",
		layers: [
			EvidenceSemanticLayer.MinimalEntry,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		// Standalone minimal-entry example for basic-auth-context-client/react.
		// Proves provider wiring, hook consumption, and zone-aware contract
		// usage from React context.
		path: "examples/basic-auth-react-minimal-entry.test.ts",
		layers: [
			EvidenceSemanticLayer.MinimalEntry,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		path: "examples/public-contract-constants.test.ts",
		layers: [EvidenceSemanticLayer.MinimalEntry],
	},
	{
		// This example backs MinimalEntry (public-contract / minimal adopter usage)
		// only. It does NOT back VerifiedEnvironments — the Verified Environments
		// section covers Node.js / browser host-capability claims (fetch, storage,
		// React), which this orchestration contract test does not address.
		path: "examples/token-orchestration-contract.test.ts",
		layers: [EvidenceSemanticLayer.MinimalEntry],
	},
	{
		// This example backs MinimalEntry for the /orchestration subpath entry
		// and root backward-compat. Not VerifiedEnvironments — same reasoning
		// as token-orchestration-contract.test.ts above.
		path: "examples/token-orchestration-subpath.test.ts",
		layers: [EvidenceSemanticLayer.MinimalEntry],
	},
	{
		// MinimalEntry evidence for @securitydept/client/auth-coordination.
		// Proves the canonical import path, multi-requirement planner usage with
		// opaque string kinds, sequential progression, and reset contract.
		// Not VerifiedEnvironments — proves adopter contract, not host capability.
		path: "examples/multi-requirement-orchestration.test.ts",
		layers: [
			EvidenceSemanticLayer.MinimalEntry,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		// Standalone minimal-entry example for access-token-substrate.
		// Proves TokenPropagation capability vocabulary and
		// AccessTokenSubstrateIntegrationInfo contract shape.
		path: "examples/access-token-substrate-minimal-entry.test.ts",
		layers: [
			EvidenceSemanticLayer.MinimalEntry,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		// This example backs MinimalEntry for the AuthMaterialController lifecycle
		// layer. It proves the controller is usable for protocol-agnostic token
		// material (OIDC and backend-issued scenarios).
		// Not VerifiedEnvironments — proves contract usability, not host capability.
		path: "examples/auth-material-controller-contract.test.ts",
		layers: [EvidenceSemanticLayer.MinimalEntry],
	},
	{
		// This example backs MinimalEntry for the frontend pure OIDC client
		// pillar (oauth4webapi wrapper). It proves the wrapper's config vocabulary,
		// error boundaries, and orchestration handoff shape.
		// Not VerifiedEnvironments — no real OIDC provider in test env.
		path: "examples/oidc-client-wrapper-contract.test.ts",
		layers: [EvidenceSemanticLayer.MinimalEntry],
	},
	{
		// Standalone minimal-entry example for frontend-oidc-mode.
		// Proves factory construction, restoreState, state signal,
		// authorizationHeader, and dispose lifecycle.
		path: "examples/frontend-oidc-minimal-entry.test.ts",
		layers: [
			EvidenceSemanticLayer.MinimalEntry,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		// Standalone minimal-entry example for session-context-client/web.
		// Proves the canonical browser import path for loginWithRedirect and
		// the LoginWithRedirectOptions named contract.
		path: "examples/session-web-minimal-entry.test.ts",
		layers: [
			EvidenceSemanticLayer.MinimalEntry,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		// Standalone minimal-entry example for basic-auth-context-client/server.
		// Proves helper construction, handleUnauthorized redirect instruction,
		// and loginUrlForPath/logoutUrlForPath usage.
		path: "examples/basic-auth-server-minimal-entry.test.ts",
		layers: [
			EvidenceSemanticLayer.MinimalEntry,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		// Standalone minimal-entry example for session-context-client/server.
		// Proves helper construction, fetchMe with cookie forwarding,
		// and loginUrl/logoutUrl generation.
		path: "examples/session-server-minimal-entry.test.ts",
		layers: [
			EvidenceSemanticLayer.MinimalEntry,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		// Visibility lifecycle hardening baseline.
		// Proves reconciler composability with AuthMaterialController
		// and throttle behavior on tab re-activation.
		path: "examples/visibility-hardening-baseline.test.ts",
		layers: [EvidenceSemanticLayer.PromotionReadiness],
	},
	{
		// Cross-tab state sync baseline.
		// Proves key-based storage event listening, filtering,
		// and composability with AuthMaterialController.
		path: "examples/cross-tab-sync-baseline.test.ts",
		layers: [EvidenceSemanticLayer.PromotionReadiness],
	},
	{
		// Route orchestration baseline with matched route chain.
		// Proves parent requirement inheritance, child append,
		// shared-prefix preservation, and chooser decision tracking.
		// Backs MinimalEntry for @securitydept/client/auth-coordination
		// (route-level orchestrator adopter contract).
		path: "examples/route-orchestration-baseline.test.ts",
		layers: [
			EvidenceSemanticLayer.MinimalEntry,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		// TanStack React Router adapter.
		// Backs MinimalEntry for @securitydept/client-react/tanstack-router.
		// Proves canonical import path, route match projection, custom requirements key,
		// activator lifecycle, and shared-prefix transition preservation.
		path: "examples/tanstack-react-router-adapter.test.ts",
		layers: [
			EvidenceSemanticLayer.MinimalEntry,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		// Angular Router adapter (route projection + guard).
		// Backs MinimalEntry for @securitydept/client-angular.
		// Proves canonical import path, pathFromRoot projection, empty-path handling,
		// routeConfig fallback, and guard adapter integration.
		path: "examples/angular-router-adapter.test.ts",
		layers: [
			EvidenceSemanticLayer.MinimalEntry,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		// Angular integration family adapter (productized Angular-native surface).
		// Proves: InjectionToken for all 3 packages, provideXxx() factories,
		// service facades, Angular signal bridge, RxJS Observable bridge,
		// bearer interceptor factory, CallbackResumeService, e2e lifecycle.
		// Tests import real @angular/core InjectionToken + signal, real RxJS Observable.
		path: "examples/angular-integration-adapter.test.ts",
		layers: [
			EvidenceSemanticLayer.PromotionReadiness,
			EvidenceSemanticLayer.MinimalEntry,
		],
	},
	{
		// Angular full-route aggregation guard (Iteration 106 canonical pattern).
		// Backs MinimalEntry for @securitydept/client-angular and
		// @securitydept/token-set-context-client-angular.
		// Proves: withRouteRequirements declaration, extractFullRouteRequirements
		// multi-level accumulation (parent + child), single-pass planner evaluation,
		// and createTokenSetRouteAggregationGuard API shape.
		path: "examples/angular-full-route-aggregation.test.ts",
		layers: [
			EvidenceSemanticLayer.PromotionReadiness,
			EvidenceSemanticLayer.MinimalEntry,
		],
	},
	{
		// React planner-host baseline.
		// Backs MinimalEntry for @securitydept/client-react root export (.).
		// Proves canonical import shape, AuthPlannerHostProvider, useAuthPlannerHost,
		// AuthRequirementsClientSetProvider, useEffectiveClientSet, and the full
		// composition semantics (inherit/merge/replace) from a React adopter perspective.
		// Also covers async selector support (chooser UI pattern).
		path: "examples/react-planner-host-baseline.test.ts",
		layers: [
			EvidenceSemanticLayer.MinimalEntry,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		// TanStack Router route-security contract (Iteration 107).
		// Backs MinimalEntry for @securitydept/client-react/tanstack-router.
		// Proves: withTanStackRouteRequirements declaration, merge/replace/inherit
		// composition, extractTanStackRouteRequirements aggregation,
		// createTanStackRouteSecurityPolicy root-level runtime policy,
		// handler resolution order, public zone via replace, and Angular parity.
		path: "examples/tanstack-route-security-contract.test.ts",
		layers: [
			EvidenceSemanticLayer.MinimalEntry,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
];

function evidenceForLayer(layer: EvidenceSemanticLayer): EvidenceFileMapping[] {
	return EVIDENCE_FILE_MAPPINGS.filter((entry) => entry.layers.includes(layer));
}

function describeLayer(layer: EvidenceSemanticLayer): string {
	switch (layer) {
		case EvidenceSemanticLayer.VerifiedEnvironments:
			return "'Currently verified' claim in docs/007-CLIENT_SDK_GUIDE";
		case EvidenceSemanticLayer.PromotionReadiness:
			return "'Current Promotion Readiness' claim in docs/007-CLIENT_SDK_GUIDE";
		case EvidenceSemanticLayer.MinimalEntry:
			return "Adopter Checklist minimal-entry section in docs/007-CLIENT_SDK_GUIDE";
	}
}

function formatLayers(layers: EvidenceSemanticLayer[]): string {
	return layers.join(", ");
}

function collectMissingEvidence(
	layer: EvidenceSemanticLayer,
): EvidenceFileMapping[] {
	return evidenceForLayer(layer).filter((entry) => {
		const fullPath = path.join(tsWorkspaceRoot, entry.path);
		return !fs.existsSync(fullPath);
	});
}

function expectLayerEvidenceIntact(layer: EvidenceSemanticLayer): void {
	const missing = collectMissingEvidence(layer);

	expect(
		missing.map(
			(entry) => `${entry.path} (backs: ${formatLayers(entry.layers)})`,
		),
		[
			"The following evidence files are missing.",
			`Each one backs a ${describeLayer(layer)}.`,
			"Overlap is intentional: a file may back multiple doc semantics at once.",
			"Either restore the file or update all affected doc sections and this guardrail.",
		].join("\n"),
	).toEqual([]);
}

describe("adopter clarity contract", () => {
	it("keeps evidence files backing verified-environment claims intact", () => {
		expectLayerEvidenceIntact(EvidenceSemanticLayer.VerifiedEnvironments);
	});

	it("keeps evidence files backing promotion-readiness claims intact", () => {
		expectLayerEvidenceIntact(EvidenceSemanticLayer.PromotionReadiness);
	});

	it("keeps evidence files backing the adopter checklist minimal entry section intact", () => {
		expectLayerEvidenceIntact(EvidenceSemanticLayer.MinimalEntry);
	});
});
