// Backend OIDC mode browser minimal entry — standalone adopter-facing evidence
//
// This test proves the browser composition path using FoundationEnvironment
// and BackendOidcModeClient directly.
//
// An adopter reading this file should understand "how do I start with
// backend-oidc in the browser?" in one glance — without needing to read
// the full browser scenario or popup baseline tests.

import {
	createFoundationEnvironment,
	createInMemoryRecordStore,
	createRootSpan,
	createTracing,
} from "@securitydept/client";
import { createRouterForNativeWeb } from "@securitydept/client/web";
import { BackendOidcModeClient } from "@securitydept/token-set-context-client/backend-oidc-mode";
import { describe, expect, it } from "vitest";

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
		const environment = createFoundationEnvironment({
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
		const client = BackendOidcModeClient.fromEnvironmentConfig({
			config: { baseUrl: "https://auth.example.com" },
			environment: environment,
		});

		// 2. Start the client. With no callback fragment and no prior state,
		//    startup resolves to null and updates authSnapshot.
		const result = await client.start();

		expect(result).toBeNull();
		expect(client.authResource.value.get()).toBeNull();

		// 3. Build the authorize URL — the adopter redirects the browser here.
		const router = createRouterForNativeWeb({
			location: { href: "https://app.example.com/dashboard", hash: "" },
		});
		const authorizeUrl = client.authorizeUrl(router?.currentUrl()?.toString());

		expect(authorizeUrl).toContain("https://auth.example.com");
		expect(authorizeUrl).toContain("post_auth_redirect_uri=");

		client.dispose();
	});

	it("shows restoreState as an alternative to bootstrap for SSR-provided tokens", async () => {
		const client = BackendOidcModeClient.fromEnvironmentConfig({
			config: { baseUrl: "https://auth.example.com" },
			environment: createFoundationEnvironment({
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
		});

		// Restore state directly (e.g. from server-rendered bootstrap data).
		await client.restoreState({
			tokens: {
				accessToken: "ssr-at",
				refreshMaterial: "ssr-rt",
			},
			metadata: {},
		});

		expect(client.authResource.value.get()?.tokens.accessToken).toBe("ssr-at");
		expect(client.authorizationHeaderValue.value.get()).toBe("Bearer ssr-at");

		client.dispose();
	});
});
