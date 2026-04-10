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

import { createInMemoryRecordStore } from "@securitydept/client";
import type { BackendOidcModeClientConfig } from "@securitydept/token-set-context-client/backend-oidc-mode";
import {
	BackendOidcModeClient,
	parseBackendOidcModeCallbackFragment,
} from "@securitydept/token-set-context-client/backend-oidc-mode";
import { describe, expect, it } from "vitest";

// Minimal runtime stubs — just enough to construct a client.
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

describe("backend-oidc-mode root minimal entry", () => {
	it("shows the standalone root entry path: construct → restoreState → state + auth header", () => {
		// 1. Config — only baseUrl is required at minimum.
		const config: BackendOidcModeClientConfig = {
			baseUrl: "https://auth.example.com",
		};

		// 2. Construct the client directly from the root subpath.
		const client = new BackendOidcModeClient(config, minimalRuntime);

		// 3. Initially unauthenticated.
		expect(client.state.get()).toBeNull();
		expect(client.authorizationHeader()).toBeNull();

		// 4. Restore state (e.g. from backend bootstrap or SSR injection).
		client.restoreState({
			tokens: {
				accessToken: "example-at",
				refreshMaterial: "example-rt",
			},
			metadata: {},
		});

		// 5. Now authenticated.
		expect(client.state.get()?.tokens.accessToken).toBe("example-at");
		expect(client.authorizationHeader()).toBe("Bearer example-at");

		client.dispose();
	});

	it("shows the callback fragment parser for host-neutral callback processing", () => {
		// The root subpath also exports protocol parsers for host-neutral
		// callback/refresh handling — no browser environment needed.
		const fragment =
			"access_token=parsed-at&id_token=parsed-idt&refresh_token=parsed-rt&expires_at=2026-01-01T00%3A05%3A00Z";

		const parsed = parseBackendOidcModeCallbackFragment(fragment);

		expect(parsed).not.toBeNull();
		expect(parsed?.accessToken).toBe("parsed-at");
		expect(parsed?.refreshToken).toBe("parsed-rt");
		expect(parsed?.expiresAt).toBe("2026-01-01T00:05:00Z");
	});
});
