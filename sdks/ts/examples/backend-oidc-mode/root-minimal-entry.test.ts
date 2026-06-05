// Backend OIDC mode root minimal entry — standalone adopter-facing evidence
//
// This test proves the standalone root entry path for
// @securitydept/token-set-context-client/backend-oidc-mode.
//
// An adopter reading this file should understand "how do I start with the
// backend-oidc-mode root subpath (not /web, not /react)?" in one glance.
//
// The root subpath is the platform-neutral core: client construction,
// state management, parsers, and authorized transport. Browser-specific
// glue lives in /web, React-specific in /react.

import {
	createFoundationEnvironment,
	createInMemoryRecordStore,
} from "@securitydept/client";
import {
	BackendOidcModeClient,
	type BackendOidcModeClientConfig,
	parseBackendOidcModeCallbackPayload,
} from "@securitydept/token-set-context-client/backend-oidc-mode";
import { describe, expect, it } from "vitest";

// Minimal runtime stubs — just enough to construct a client.
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

describe("backend-oidc-mode root minimal entry", () => {
	it("shows the standalone root entry path: construct → restoreState → state + auth header", async () => {
		// 1. Config — only baseUrl is required at minimum.
		const config: BackendOidcModeClientConfig = {
			baseUrl: "https://auth.example.com",
		};

		// 2. Construct the client directly from the root subpath.
		const client = new BackendOidcModeClient(config, minimalRuntime);

		// 3. Initially undetermined.
		expect(client.authSnapshot.get()).toEqual({ status: "idle" });
		expect(client.authorizationHeaderValue.hasValue()).toBe(false);

		// 4. Restore state (e.g. from backend bootstrap or SSR injection).
		await client.restoreState({
			tokens: {
				accessToken: "example-at",
				refreshMaterial: "example-rt",
			},
			metadata: {},
		});

		// 5. Now authenticated.
		expect(client.authResource.value.get()?.tokens.accessToken).toBe(
			"example-at",
		);
		expect(client.authorizationHeaderValue.value.get()).toBe(
			"Bearer example-at",
		);

		client.dispose();
	});

	it("shows the callback payload parser for host-neutral callback processing", () => {
		// The root subpath also exports protocol parsers for host-neutral
		// callback/refresh handling — no browser environment needed.
		const parsed = parseBackendOidcModeCallbackPayload({
			access_token: "parsed-at",
			id_token: "parsed-idt",
			refresh_token: "parsed-rt",
			access_token_expires_at: "2026-01-01T00:05:00Z",
		});

		expect(parsed).not.toBeNull();
		expect(parsed?.accessToken).toBe("parsed-at");
		expect(parsed?.refreshToken).toBe("parsed-rt");
		expect(parsed?.expiresAt).toBe("2026-01-01T00:05:00Z");
	});
});
