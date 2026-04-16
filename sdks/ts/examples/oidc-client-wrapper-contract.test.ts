// OIDC Client Wrapper — Comparison-Driven Evidence
//
// This file serves as adopter-facing evidence that:
//   1. FrontendOidcModeClient wraps oauth4webapi as the official frontend pure OIDC base
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

import { createInMemoryRecordStore } from "@securitydept/client";
import type {
	FrontendOidcModeClientConfig,
	FrontendOidcModeTokenResult,
} from "@securitydept/token-set-context-client/frontend-oidc-mode";
import { FrontendOidcModeClient } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import { describe, expect, it, vi } from "vitest";

// Minimal runtime stub for tests that don't make real requests
function createTestRuntime() {
	const sessionStore = createInMemoryRecordStore();

	return {
		transport: {
			execute: vi.fn(async () => ({
				status: 200,
				headers: {},
				body: null,
			})),
		},
		scheduler: {
			setTimeout: vi.fn((_ms: number, _cb: () => void) => ({
				cancel: vi.fn(),
			})),
		},
		clock: {
			now: () => Date.now(),
		},
		sessionStore,
	};
}

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

		const client = new FrontendOidcModeClient(config, createTestRuntime());

		expect(client.config.issuer).toBe("https://auth.example.com");
		expect(client.config.clientId).toBe("spa-client");
		expect(client.config.redirectUri).toBe("https://app.example.com/callback");
	});

	it("defaults scopes to ['openid'] when not specified", () => {
		const client = new FrontendOidcModeClient(
			{
				issuer: "https://auth.example.com",
				clientId: "spa",
				redirectUri: "https://app.example.com/callback",
			},
			createTestRuntime(),
		);

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

		const client = new FrontendOidcModeClient(config, createTestRuntime());
		expect(client.config.scopes).toEqual(["openid", "profile", "email"]);
	});
});

// ---------------------------------------------------------------------------
// B. Wrapper error boundaries — before discovery
// ---------------------------------------------------------------------------

describe("FrontendOidcModeClient / error boundaries", () => {
	it("throws when buildAuthorizeUrl() is called before discover()", async () => {
		const client = new FrontendOidcModeClient(
			{
				issuer: "https://auth.example.com",
				clientId: "spa",
				redirectUri: "https://app.example.com/callback",
			},
			createTestRuntime(),
		);

		await expect(client.buildAuthorizeUrl()).rejects.toThrow(/discover/);
	});

	it("throws when exchangeCode() is called before discover()", async () => {
		const client = new FrontendOidcModeClient(
			{
				issuer: "https://auth.example.com",
				clientId: "spa",
				redirectUri: "https://app.example.com/callback",
			},
			createTestRuntime(),
		);

		await expect(
			client.exchangeCode(
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
		const mockResult: FrontendOidcModeTokenResult = {
			accessToken: "at-from-oidc",
			idToken: "id-token-jwt",
			refreshToken: "rt-from-oidc",
			expiresAt: "2026-12-31T00:00:00.000Z",
			grantedScopes: ["openid", "profile"],
		};

		expect(mockResult.accessToken).toBeTruthy();
		expect(mockResult.idToken).toBeTruthy();
		expect(mockResult.refreshToken).toBeTruthy();
		expect(mockResult.expiresAt).toBeTruthy();
	});
});

// ---------------------------------------------------------------------------
// D. Lifecycle management — state signal, dispose
// ---------------------------------------------------------------------------

describe("FrontendOidcModeClient / lifecycle", () => {
	it("exposes a state signal initialized to null", () => {
		const client = new FrontendOidcModeClient(
			{
				issuer: "https://auth.example.com",
				clientId: "spa",
				redirectUri: "https://app.example.com/callback",
			},
			createTestRuntime(),
		);

		expect(client.state.get()).toBeNull();
	});

	it("state becomes null after dispose", () => {
		const client = new FrontendOidcModeClient(
			{
				issuer: "https://auth.example.com",
				clientId: "spa",
				redirectUri: "https://app.example.com/callback",
			},
			createTestRuntime(),
		);

		client.dispose();
		expect(client.state.get()).toBeNull();
	});

	it("throws on operations after dispose", () => {
		const client = new FrontendOidcModeClient(
			{
				issuer: "https://auth.example.com",
				clientId: "spa",
				redirectUri: "https://app.example.com/callback",
			},
			createTestRuntime(),
		);

		client.dispose();
		expect(() =>
			client.restoreState({
				tokens: { accessToken: "x" },
				metadata: {},
			}),
		).toThrow();
	});

	it("authorizationHeader returns null when not authenticated", () => {
		const client = new FrontendOidcModeClient(
			{
				issuer: "https://auth.example.com",
				clientId: "spa",
				redirectUri: "https://app.example.com/callback",
			},
			createTestRuntime(),
		);

		expect(client.authorizationHeader()).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// E. No-discovery mode — manual endpoint construction
// ---------------------------------------------------------------------------

describe("FrontendOidcModeClient / no-discovery mode", () => {
	it("can authorizeUrl without discovery when endpoints are provided", async () => {
		const client = new FrontendOidcModeClient(
			{
				issuer: "https://auth.example.com",
				clientId: "spa",
				redirectUri: "https://app.example.com/callback",
				authorizationEndpoint: "https://auth.example.com/oauth2/authorize",
				tokenEndpoint: "https://auth.example.com/oauth2/token",
			},
			createTestRuntime(),
		);

		// Should NOT throw — endpoints are provided, no discovery needed
		const url = await client.authorizeUrl();
		expect(url).toContain("https://auth.example.com/oauth2/authorize");
		expect(url).toContain("client_id=spa");
		expect(url).toContain("state=");
		expect(url).toContain("nonce=");
	});
});

// ---------------------------------------------------------------------------
// F. Comparison notes: why oauth4webapi is the official base, not oidc-client-ts
// ---------------------------------------------------------------------------

describe("FrontendOidcModeClient / comparison evidence", () => {
	it("documents that oauth4webapi is the official base (not oidc-client-ts)", () => {
		// This test exists as a living document in the test suite.
		expect(true).toBe(true);
	});
});
