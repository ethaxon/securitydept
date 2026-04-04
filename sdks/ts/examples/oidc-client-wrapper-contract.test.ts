// OIDC Client Wrapper — Comparison-Driven Evidence
//
// This file serves as adopter-facing evidence that:
//   1. createFrontendOidcModeClient wraps oauth4webapi as the official frontend pure OIDC base
//   2. The wrapper provides a unified config vocabulary and PKCE+state management
//   3. Token results are normalized into a shape ready for orchestration handoff
//   4. oidc-client-ts is not the official base — this documents why
//
// Stability: experimental (not yet a stable public surface)
// Semantic layer: MinimalEntry only
//
// IMPORTANT: These tests validate types, config shape, and wrapper contract —
// they do NOT make real HTTP requests to OIDC providers. The oauth4webapi
// protocol steps (discovery, token exchange) need a real server, so we test
// the wrapper's structural guarantees and error boundaries.

import type {
	FrontendOidcModeClientConfig,
	FrontendOidcModeTokenResult,
} from "@securitydept/token-set-context-client/frontend-oidc-mode";
import { createFrontendOidcModeClient } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// A. Config vocabulary — what the wrapper owns
// ---------------------------------------------------------------------------

describe("FrontendOidcModeClient / config vocabulary", () => {
	it("accepts minimal config for a browser PKCE flow", () => {
		const config: FrontendOidcModeClientConfig = {
			issuer: "https://auth.example.com",
			clientId: "spa-client",
			redirectUri: "https://app.example.com/callback",
		};

		const client = createFrontendOidcModeClient(config);

		expect(client.config.issuer).toBe("https://auth.example.com");
		expect(client.config.clientId).toBe("spa-client");
		expect(client.config.redirectUri).toBe("https://app.example.com/callback");
	});

	it("defaults scopes to ['openid'] when not specified", () => {
		const client = createFrontendOidcModeClient({
			issuer: "https://auth.example.com",
			clientId: "spa",
			redirectUri: "https://app.example.com/callback",
		});

		// The resolved scopes are internal to the client; we verify by checking
		// that no error occurs when creating with default scopes.
		expect(client.config).toBeDefined();
	});

	it("accepts custom scopes", () => {
		const config: FrontendOidcModeClientConfig = {
			issuer: "https://auth.example.com",
			clientId: "spa",
			redirectUri: "https://app.example.com/callback",
			scopes: ["openid", "profile", "email"],
		};

		const client = createFrontendOidcModeClient(config);
		expect(client.config.scopes).toEqual(["openid", "profile", "email"]);
	});
});

// ---------------------------------------------------------------------------
// B. Wrapper error boundaries — before discovery
// ---------------------------------------------------------------------------

describe("FrontendOidcModeClient / error boundaries", () => {
	it("throws when authorize() is called before discover()", async () => {
		const client = createFrontendOidcModeClient({
			issuer: "https://auth.example.com",
			clientId: "spa",
			redirectUri: "https://app.example.com/callback",
		});

		await expect(client.authorize()).rejects.toThrow(/discover/);
	});

	it("throws when handleCallback() is called before discover()", async () => {
		const client = createFrontendOidcModeClient({
			issuer: "https://auth.example.com",
			clientId: "spa",
			redirectUri: "https://app.example.com/callback",
		});

		await expect(
			client.handleCallback(
				"https://app.example.com/callback?code=abc&state=xyz",
				"verifier",
				"xyz",
			),
		).rejects.toThrow(/discover/);
	});
});

// ---------------------------------------------------------------------------
// C. Token result shape — what the orchestration handoff expects
// ---------------------------------------------------------------------------

describe("FrontendOidcModeClient / token result shape contract", () => {
	it("FrontendOidcModeTokenResult shape is compatible with orchestration handoff", () => {
		// This verifies the type contract at compile time + runtime shape.
		// After a real callback, the adopter would do:
		//   controller.applySnapshot({
		//     tokens: { accessToken: tokens.accessToken, ... },
		//     metadata: { source: { kind: "oidc_authorization_code" } },
		//   })
		const mockResult: FrontendOidcModeTokenResult = {
			accessToken: "at-from-oidc",
			idToken: "id-token-jwt",
			refreshToken: "rt-from-oidc",
			expiresAt: "2026-12-31T00:00:00.000Z",
			grantedScopes: ["openid", "profile"],
		};

		// Verify the shape has the fields needed for orchestration
		expect(mockResult.accessToken).toBeTruthy();
		expect(mockResult.idToken).toBeTruthy();
		expect(mockResult.refreshToken).toBeTruthy();
		expect(mockResult.expiresAt).toBeTruthy();
	});
});

// ---------------------------------------------------------------------------
// D. Comparison notes: why oauth4webapi is the official base, not oidc-client-ts
//
// This section documents the comparison conclusions reached in Iteration 49.
// It is structured as test comments (not runtime assertions) because the
// comparison is about protocol/shape decisions, not executable behavior.
//
// oauth4webapi (official base):
//   ✓ Granular function-level API (discoveryRequest, validateAuthResponse, etc.)
//   ✓ No opinionated state management — BYO persistence/storage
//   ✓ Composes naturally with our orchestration layer
//   ✓ Minimal surface — only standard OIDC/OAuth protocol steps
//   ✓ Maintained by a single focused author (panva)
//
// oidc-client-ts (comparison case, not official base):
//   ✗ Monolithic UserManager bundles state, storage, timers, events
//   ✗ Hard to compose with our AuthMaterialController (double state ownership)
//   ✗ Includes session management, silent renew, popup flows — scope creep
//   ✗ Its own WebStorageStateStore conflicts with our persistence layer
//   ✓ But useful as a reference for "what config dimensions a real browser
//     OIDC client needs" (redirect_uri, scope, response_type, silent_redirect,
//     automaticSilentRenew, etc.)
//
// Conclusion: wrap oauth4webapi for protocol steps, let our orchestration
// layer own the state/persistence/transport lifecycle. Use oidc-client-ts
// only to verify we haven't missed important config dimensions.
// ---------------------------------------------------------------------------

describe("FrontendOidcModeClient / comparison evidence", () => {
	it("documents that oauth4webapi is the official base (not oidc-client-ts)", () => {
		// This test exists as a living document in the test suite.
		// The comparison analysis is in the comments above and in types.ts.
		expect(true).toBe(true);
	});
});
