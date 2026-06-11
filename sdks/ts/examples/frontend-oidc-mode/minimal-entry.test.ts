// Frontend OIDC mode minimal entry — standalone adopter-facing evidence
//
// This test proves the standalone entry path for
// @securitydept/token-set-context-client/frontend-oidc-mode.
//
// An adopter reading this file should understand "how do I start with
// frontend-oidc-mode?" in one glance — without needing to read the
// oidc-client-wrapper-contract comparison notes.

import {
	createFoundationEnvironment,
	createInMemoryRecordStore,
} from "@securitydept/client";
import {
	FrontendOidcModeClient,
	type FrontendOidcModeClientConfig,
} from "@securitydept/token-set-context-client/frontend-oidc-mode";
import { describe, expect, it } from "vitest";

// Minimal runtime stubs — just enough to construct a client.
// In a real app, these come from the @securitydept/client runtime layer.
const minimalRuntime = createFoundationEnvironment({
	transport: {
		async execute() {
			return { status: 500, headers: {}, body: null };
		},
	},
	time: {
		now: () => Date.now(),
		setTimeout: (callback: () => void, delayMs: number) =>
			globalThis.setTimeout(callback, delayMs),
		clearTimeout: (handle: unknown) =>
			globalThis.clearTimeout(
				handle as ReturnType<typeof globalThis.setTimeout>,
			),
	},
	persistentStorage: createInMemoryRecordStore(),
	sessionStorage: createInMemoryRecordStore(),
});

// Minimal OIDC config — enough to construct the client without discovery.
// In a real app, issuer/clientId/redirectUri come from app config or
// a backend config projection.
const minimalConfig: FrontendOidcModeClientConfig = {
	issuer: "https://idp.example.com",
	clientId: "my-app",
	redirectUri: "https://app.example.com/callback",
	// Provide explicit endpoints to skip OIDC discovery in tests.
	authorizationEndpoint: "https://idp.example.com/authorize",
	tokenEndpoint: "https://idp.example.com/token",
};

describe("frontend-oidc-mode minimal entry", () => {
	it("shows the standalone entry path: construct → restoreState → read auth state + authorization header", async () => {
		// 1. Create client via constructor.
		const client = new FrontendOidcModeClient(minimalConfig, {
			environment: minimalRuntime,
		});
		expect(client).toBeInstanceOf(FrontendOidcModeClient);

		// 2. Initially idle: auth snapshot has no value and no auth header.
		expect(client.authSnapshot.get()).toEqual({ status: "idle" });
		expect(client.authorizationHeaderValue.hasValue()).toBe(false);

		// 3. Restore state (e.g. from SSR bootstrap or persisted storage).
		await client.restoreState({
			tokens: {
				accessToken: "eyJhbGci.example.access-token",
				refreshMaterial: "example-refresh-token",
			},
			metadata: {},
		});

		// 4. Now authenticated: state reflects tokens, auth header is set.
		const state = client.authResource.value.get();
		expect(state).not.toBeNull();
		expect(state?.tokens.accessToken).toBe("eyJhbGci.example.access-token");

		const authHeader = client.authorizationHeaderValue.value.get();
		expect(authHeader).toBe("Bearer eyJhbGci.example.access-token");

		// 5. Clean up — dispose marks the client non-operational.
		client.dispose();
		await expect(
			client.restoreState({
				tokens: { accessToken: "x" },
				metadata: {},
			}),
		).rejects.toThrow();
	});

	it("shows the config type import and client state signal subscription", async () => {
		const client = new FrontendOidcModeClient(minimalConfig, {
			environment: minimalRuntime,
		});

		// Subscribe to auth snapshot changes via the signal.
		const observed: Array<string | null> = [];
		const subscription = client.authSnapshot.watchStream().subscribe({
			next() {
				const snapshot = client.authResource.value.get();
				observed.push(snapshot?.tokens.accessToken ?? null);
			},
		});

		// Trigger a state change.
		await client.restoreState({
			tokens: { accessToken: "first-at" },
			metadata: {},
		});

		expect(observed).toContain("first-at");

		subscription.unsubscribe();
		client.dispose();
	});
});
