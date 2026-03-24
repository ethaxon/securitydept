/// <reference types="node" />

// This guardrail ensures that the evidence files backing the verified-environment
// and adopter-checklist claims in docs/007-CLIENT_SDK_GUIDE stay intact.
// It does not assert content — only existence. If any file is removed, this test
// fails and forces an explicit update to both the guardrail and the documentation.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const tsWorkspaceRoot = path.resolve(import.meta.dirname, "../");

// Evidence for "Currently verified" claims in the Verified Environments section.
// Each file here backs at least one row in the host-assumption tables.
const VERIFIED_ENVIRONMENT_EVIDENCE: string[] = [
	// Backs: Foundation + Browser Capability Adapter currently verified claim
	"examples/minimal-entry-points.test.ts",
	// Backs: Auth-Context Web Adapter (token-set/web) currently verified claim
	"packages/token-set-context-client/src/__tests__/web.test.ts",
	// Backs: React Adapter (token-set/react) currently verified claim
	"packages/token-set-context-client/src/react/__tests__/adapter.test.ts",
	// Backs: external-consumer scenario evidence for all stable root exports
	"examples/token-set-browser-scenario.test.ts",
	"examples/basic-auth-guard-scenario.test.ts",
	"examples/session-context-scenario.test.ts",
];

// Entry-point examples that the Adopter Checklist section references.
// The "Before You Adopt" and minimal entry snippets depend on these being importable.
const MINIMAL_ENTRY_EVIDENCE: string[] = [
	"examples/public-contract-constants.test.ts",
	"examples/minimal-entry-points.test.ts",
];

describe("adopter clarity contract", () => {
	it("keeps evidence files backing verified-environment claims intact", () => {
		const missing: string[] = [];

		for (const relPath of VERIFIED_ENVIRONMENT_EVIDENCE) {
			const fullPath = path.join(tsWorkspaceRoot, relPath);
			if (!fs.existsSync(fullPath)) {
				missing.push(relPath);
			}
		}

		expect(
			missing,
			[
				"The following evidence files are missing.",
				"Each one backs a 'Currently verified' claim in docs/007-CLIENT_SDK_GUIDE.",
				"Either restore the file or update both the doc and this guardrail.",
			].join("\n"),
		).toEqual([]);
	});

	it("keeps evidence files backing the adopter checklist minimal entry section intact", () => {
		const missing: string[] = [];

		for (const relPath of MINIMAL_ENTRY_EVIDENCE) {
			const fullPath = path.join(tsWorkspaceRoot, relPath);
			if (!fs.existsSync(fullPath)) {
				missing.push(relPath);
			}
		}

		expect(
			missing,
			[
				"The following evidence files are missing.",
				"Each one backs the Adopter Checklist section in docs/007-CLIENT_SDK_GUIDE.",
				"Either restore the file or update both the doc and this guardrail.",
			].join("\n"),
		).toEqual([]);
	});
});
