// Access-token substrate minimal entry — standalone adopter-facing evidence
//
// This test proves the standalone entry path for
// @securitydept/token-set-context-client/access-token-substrate.
//
// An adopter reading this file should understand "what is the access-token
// substrate subpath and when do I use it?" in one glance.
//
// The substrate subpath provides cross-mode capability contracts that sit
// BENEATH all OIDC modes (backend-oidc, frontend-oidc). These describe
// substrate-level capabilities like token propagation that apply to any
// access token regardless of how it was produced.
//
// Key boundary:
//   /access-token-substrate — substrate capability vocabulary (this subpath)
//   /orchestration          — token lifecycle management (controller, planner)
//   /backend-oidc-mode      — backend-oidc specific client + contracts

import type { AccessTokenSubstrateIntegrationInfo } from "@securitydept/token-set-context-client/access-token-substrate";
import { TokenPropagation } from "@securitydept/token-set-context-client/access-token-substrate";
import { describe, expect, it } from "vitest";

describe("access-token-substrate minimal entry", () => {
	it("shows the substrate capability vocabulary: TokenPropagation", () => {
		// TokenPropagation is a substrate-level constant, not mode-specific.
		// It tells the frontend whether the backend supports forwarding
		// validated bearer tokens to downstream services.
		expect(TokenPropagation.Enabled).toBe("enabled");
		expect(TokenPropagation.Disabled).toBe("disabled");

		// Example: use capability value to gate UI features.
		const capability: string = TokenPropagation.Enabled;
		const showPropagationSettings = capability === TokenPropagation.Enabled;
		expect(showPropagationSettings).toBe(true);
	});

	it("shows the substrate integration info contract shape", () => {
		// AccessTokenSubstrateIntegrationInfo describes substrate-level
		// capabilities exposed by the backend — independent of OIDC mode.
		const info: AccessTokenSubstrateIntegrationInfo = {
			supportsPropagation: true,
		};

		expect(info.supportsPropagation).toBe(true);

		// When not provided, the adopter treats propagation as unavailable.
		const emptyInfo: AccessTokenSubstrateIntegrationInfo = {};
		expect(emptyInfo.supportsPropagation).toBeUndefined();
	});
});
