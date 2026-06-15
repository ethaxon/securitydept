/// <reference types="node" />

// This guardrail ensures that the evidence files backing the verified-environment,
// promotion-readiness, and adopter-checklist claims in docs/007-CLIENT_SDK_GUIDE
// stay intact.
// It does not assert content — only existence. If any file is removed, this test
// fails and forces an explicit update to both the guardrail and the documentation.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const tsWorkspaceRoot = path.resolve(import.meta.dirname, "../../");

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
		path: "examples/meta/minimal-entry-points.test.ts",
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
		path: "packages/token-set-context-client-react/src/__tests__/client-registry.test.tsx",
		layers: [
			EvidenceSemanticLayer.VerifiedEnvironments,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		path: "examples/backend-oidc-mode/react-minimal-entry.test.ts",
		layers: [
			EvidenceSemanticLayer.MinimalEntry,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		path: "examples/backend-oidc-mode/browser-scenario.test.ts",
		layers: [EvidenceSemanticLayer.VerifiedEnvironments],
	},
	{
		path: "examples/backend-oidc-mode/browser-minimal-entry.test.ts",
		layers: [
			EvidenceSemanticLayer.MinimalEntry,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		path: "examples/backend-oidc-mode/root-minimal-entry.test.ts",
		layers: [
			EvidenceSemanticLayer.MinimalEntry,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		path: "examples/basic-auth/guard-scenario.test.ts",
		layers: [
			EvidenceSemanticLayer.VerifiedEnvironments,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		path: "examples/session-context/scenario.test.ts",
		layers: [EvidenceSemanticLayer.VerifiedEnvironments],
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
		path: "examples/session-context/react-minimal-entry.test.ts",
		layers: [
			EvidenceSemanticLayer.PromotionReadiness,
			EvidenceSemanticLayer.MinimalEntry,
		],
	},
	{
		path: "examples/basic-auth/react-minimal-entry.test.ts",
		layers: [
			EvidenceSemanticLayer.MinimalEntry,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		path: "examples/meta/public-contract-constants.test.ts",
		layers: [EvidenceSemanticLayer.MinimalEntry],
	},
	{
		path: "examples/token-set/access-token-substrate-minimal-entry.test.ts",
		layers: [EvidenceSemanticLayer.MinimalEntry],
	},
	{
		path: "packages/token-set-context-client/src/orchestration/__tests__/token-ops.test.ts",
		layers: [EvidenceSemanticLayer.MinimalEntry],
	},
	{
		path: "examples/backend-oidc-mode/subpath-contract.test.ts",
		layers: [EvidenceSemanticLayer.MinimalEntry],
	},
	{
		path: "packages/client/src/auth-coordination/__tests__/contract.test.ts",
		layers: [
			EvidenceSemanticLayer.MinimalEntry,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		path: "examples/frontend-oidc-mode/wrapper-contract.test.ts",
		layers: [EvidenceSemanticLayer.MinimalEntry],
	},
	{
		path: "examples/frontend-oidc-mode/minimal-entry.test.ts",
		layers: [
			EvidenceSemanticLayer.MinimalEntry,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		path: "examples/session-context/browser-minimal-entry.test.ts",
		layers: [
			EvidenceSemanticLayer.MinimalEntry,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		path: "examples/session-context/server-minimal-entry.test.ts",
		layers: [
			EvidenceSemanticLayer.MinimalEntry,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		path: "examples/angular/full-route-aggregation.test.ts",
		layers: [
			EvidenceSemanticLayer.MinimalEntry,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		path: "examples/react/tanstack-route-security-contract.test.ts",
		layers: [
			EvidenceSemanticLayer.MinimalEntry,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		path: "examples/angular/router-adapter.test.ts",
		layers: [
			EvidenceSemanticLayer.MinimalEntry,
			EvidenceSemanticLayer.PromotionReadiness,
		],
	},
	{
		path: "examples/angular/registry-integration.test.ts",
		layers: [
			EvidenceSemanticLayer.PromotionReadiness,
			EvidenceSemanticLayer.MinimalEntry,
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
