// Backend OIDC mode browser (web) minimal entry — standalone adopter-facing evidence
//
// This test proves the standalone browser entry path for
// @securitydept/token-set-context-client/backend-oidc-mode/web.
//
// An adopter reading this file should understand "how do I start with
// backend-oidc in the browser?" in one glance — without needing to read
// the full browser scenario or popup baseline tests.

import { createInMemoryRecordStore } from "@securitydept/client";
import {
	BackendOidcModeBootstrapSource,
	bootstrapBackendOidcModeClient,
	createBackendOidcModeBrowserClient,
	createBackendOidcModeCallbackFragmentStore,
	resolveBackendOidcModeAuthorizeUrl,
} from "@securitydept/token-set-context-client/backend-oidc-mode/web";
import { describe, expect, it } from "vitest";

describe("backend-oidc-mode web minimal entry", () => {
	it("shows the standalone browser entry path: create client → bootstrap → authorize URL", async () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();

		// 1. Create the browser client with minimal config + runtime stubs.
		//    In a real app, only baseUrl is required — stores and transport
		//    default to browser-native implementations.
		const client = createBackendOidcModeBrowserClient({
			baseUrl: "https://auth.example.com",
			persistentStore,
			sessionStore,
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
		});

		// 2. Bootstrap the client — checks for callback fragment and persisted state.
		//    With no fragment and no prior state, bootstrap returns Empty.
		const callbackFragmentStore = createBackendOidcModeCallbackFragmentStore({
			sessionStore,
		});
		const result = await bootstrapBackendOidcModeClient(client, {
			location: { href: "https://app.example.com/dashboard", hash: "" },
			history: { replaceState() {} },
			callbackFragmentStore,
		});

		expect(result.source).toBe(BackendOidcModeBootstrapSource.Empty);
		expect(result.snapshot).toBeNull();
		expect(client.state.get()).toBeNull();

		// 3. Build the authorize URL — the adopter redirects the browser here.
		const authorizeUrl = resolveBackendOidcModeAuthorizeUrl(client, {
			href: "https://app.example.com/dashboard",
		});

		expect(authorizeUrl).toContain("https://auth.example.com");
		expect(authorizeUrl).toContain("post_auth_redirect_uri=");

		client.dispose();
	});

	it("shows restoreState as an alternative to bootstrap for SSR-provided tokens", () => {
		const client = createBackendOidcModeBrowserClient({
			baseUrl: "https://auth.example.com",
			persistentStore: createInMemoryRecordStore(),
			sessionStore: createInMemoryRecordStore(),
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
		});

		// Restore state directly (e.g. from server-rendered bootstrap data).
		client.restoreState({
			tokens: {
				accessToken: "ssr-at",
				refreshMaterial: "ssr-rt",
			},
			metadata: {},
		});

		expect(client.state.get()?.tokens.accessToken).toBe("ssr-at");
		expect(client.authorizationHeader()).toBe("Bearer ssr-at");

		client.dispose();
	});
});
