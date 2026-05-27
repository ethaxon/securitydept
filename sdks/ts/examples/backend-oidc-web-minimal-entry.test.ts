// Backend OIDC mode browser (web) minimal entry — standalone adopter-facing evidence
//
// This test proves the standalone browser entry path for
// @securitydept/token-set-context-client/backend-oidc-mode/web.
//
// An adopter reading this file should understand "how do I start with
// backend-oidc in the browser?" in one glance — without needing to read
// the full browser scenario or popup baseline tests.

import {
	createInMemoryRecordStore,
	createRootSpan,
	createTracing,
} from "@securitydept/client";
import { createRouterForNativeWeb } from "@securitydept/client/web";
import {
	BackendOidcModeBootstrapSource,
	bootstrapBackendOidcModePageClient,
	buildAuthorizeUrlReturningToCurrentPage,
	createBackendOidcModeCallbackFragmentStore,
	createBackendOidcModeWebClient,
	createBackendOidcModeWebClientEnvironment,
} from "@securitydept/token-set-context-client/backend-oidc-mode/web";
import { describe, expect, it } from "vitest";

function expectReplayValue<T>(signal: {
	get(): { kind: "empty" } | { kind: "value"; value: T };
}): T {
	const slot = signal.get();
	expect(slot.kind).toBe("value");
	if (slot.kind !== "value") {
		throw new Error("Expected replay signal value.");
	}
	return slot.value;
}

describe("backend-oidc-mode web minimal entry", () => {
	it("shows the standalone browser entry path: create client → bootstrap → authorize URL", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const time = {
			now: () => Date.now(),
			setTimeout: (callback: () => void, delayMs: number) =>
				globalThis.setTimeout(callback, delayMs),
			clearTimeout: (handle: unknown) =>
				globalThis.clearTimeout(
					handle as ReturnType<typeof globalThis.setTimeout>,
				),
		};
		const environment = createBackendOidcModeWebClientEnvironment({
			span: createRootSpan(),
			tracing: createTracing(),
			persistentStorage,
			sessionStorage,
			transport: {
				async execute() {
					return { status: 500, headers: {}, body: null };
				},
			},
			time,
		});

		// 1. Create the browser client with minimal config + runtime stubs.
		//    In a real app, only baseUrl is required — stores and transport
		//    default to browser-native implementations.
		const client = createBackendOidcModeWebClient({
			environment,
			baseUrl: "https://auth.example.com",
		});

		// 2. Bootstrap the client — checks for callback fragment and persisted state.
		//    With no fragment and no prior state, bootstrap returns Empty.
		const callbackFragmentStore = createBackendOidcModeCallbackFragmentStore({
			sessionStorage,
		});
		const result = await bootstrapBackendOidcModePageClient(client, {
			environment: {
				...createRouterForNativeWeb({
					location: { href: "https://app.example.com/dashboard", hash: "" },
					history: { replaceState() {} },
				}),
				callbackFragmentStore,
				time,
			},
		});

		expect(result.source).toBe(BackendOidcModeBootstrapSource.Empty);
		expect(result.snapshot).toBeNull();
		expect(expectReplayValue(client.authSnapshot)).toBeNull();

		// 3. Build the authorize URL — the adopter redirects the browser here.
		const authorizeUrl = buildAuthorizeUrlReturningToCurrentPage(client, {
			environment: createRouterForNativeWeb({
				location: { href: "https://app.example.com/dashboard", hash: "" },
			}),
		});

		expect(authorizeUrl).toContain("https://auth.example.com");
		expect(authorizeUrl).toContain("post_auth_redirect_uri=");

		client.dispose();
	});

	it("shows restoreState as an alternative to bootstrap for SSR-provided tokens", () => {
		const client = createBackendOidcModeWebClient({
			environment: createBackendOidcModeWebClientEnvironment({
				span: createRootSpan(),
				tracing: createTracing(),
				persistentStorage: createInMemoryRecordStore(),
				sessionStorage: createInMemoryRecordStore(),
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
			}),
			baseUrl: "https://auth.example.com",
		});

		// Restore state directly (e.g. from server-rendered bootstrap data).
		client.restoreState({
			tokens: {
				accessToken: "ssr-at",
				refreshMaterial: "ssr-rt",
			},
			metadata: {},
		});

		expect(expectReplayValue(client.authSnapshot)?.tokens.accessToken).toBe(
			"ssr-at",
		);
		expect(expectReplayValue(client.authorizationHeaderValue)).toBe(
			"Bearer ssr-at",
		);

		client.dispose();
	});
});
