// Frontend OIDC mode minimal entry — standalone adopter-facing evidence
//
// This test proves the standalone entry path for
// @securitydept/token-set-context-client/frontend-oidc-mode.
//
// An adopter reading this file should understand "how do I start with
// frontend-oidc-mode?" in one glance — without needing to read the
// oidc-client-wrapper-contract comparison notes.

import { createInMemoryRecordStore } from "@securitydept/client";
import type { FrontendOidcModeClientConfig } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import {
	createFrontendOidcModeClient,
	FrontendOidcModeClient,
} from "@securitydept/token-set-context-client/frontend-oidc-mode";
import { describe, expect, it } from "vitest";

// Minimal runtime stubs — just enough to construct a client.
// In a real app, these come from the @securitydept/client runtime layer.
const minimalRuntime = {
	transport: {
		async execute() {
			return { status: 500, headers: {}, body: null };
		},
	},
	scheduler: {
		setTimeout() {
			return { cancel() {} };
		},
	},
	clock: { now: () => Date.now() },
	persistentStore: createInMemoryRecordStore(),
	sessionStore: createInMemoryRecordStore(),
};

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
	it("shows the standalone entry path: construct → restoreState → read auth state + authorization header", () => {
		// 1. Create client via factory or constructor.
		const client = createFrontendOidcModeClient(minimalConfig, minimalRuntime);
		expect(client).toBeInstanceOf(FrontendOidcModeClient);

		// 2. Initially unauthenticated: state is null, no auth header.
		expect(client.state.get()).toBeNull();
		expect(client.authorizationHeader()).toBeNull();

		// 3. Restore state (e.g. from SSR bootstrap or persisted storage).
		client.restoreState({
			tokens: {
				accessToken: "eyJhbGci.example.access-token",
				refreshMaterial: "example-refresh-token",
			},
			metadata: {},
		});

		// 4. Now authenticated: state reflects tokens, auth header is set.
		const state = client.state.get();
		expect(state).not.toBeNull();
		expect(state?.tokens.accessToken).toBe("eyJhbGci.example.access-token");

		const authHeader = client.authorizationHeader();
		expect(authHeader).toBe("Bearer eyJhbGci.example.access-token");

		// 5. Clean up.
		client.dispose();
		expect(client.state.get()).toBeNull();
	});

	it("shows the config type import and client state signal subscription", () => {
		const client = createFrontendOidcModeClient(minimalConfig, minimalRuntime);

		// Subscribe to state changes via the signal.
		const observed: Array<string | null> = [];
		const unsubscribe = client.state.subscribe(() => {
			const snapshot = client.state.get();
			observed.push(snapshot?.tokens.accessToken ?? null);
		});

		// Trigger a state change.
		client.restoreState({
			tokens: { accessToken: "first-at" },
			metadata: {},
		});

		expect(observed).toContain("first-at");

		unsubscribe();
		client.dispose();
	});
});
