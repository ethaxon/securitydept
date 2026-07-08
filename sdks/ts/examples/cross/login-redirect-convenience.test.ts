import {
	createFoundationEnvironment,
	createInMemoryRecordStore,
	createRootSpan,
	createTracing,
	type RouterTrait,
} from "@securitydept/client";
import { createRouterForNativeWeb } from "@securitydept/client/web";
import {
	SessionContextClient,
	type SessionLoginWithRedirectOptions,
} from "@securitydept/session-context-client";
import { BackendOidcModeClient } from "@securitydept/token-set-context-client/backend-oidc-mode";
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createPageLocationCapability(href: string): RouterTrait & {
	location: {
		href: string;
		hash: string;
		pathname: string;
		search: string;
	};
} {
	const url = new URL(href);
	const capability = {
		location: {
			href,
			hash: url.hash,
			pathname: url.pathname,
			search: url.search,
		},
	};
	const router = createRouterForNativeWeb(capability);
	if (!router) {
		throw new Error("Expected native web router capability.");
	}
	return {
		...capability,
		...router,
	};
}

// ===========================================================================
// 1. session-context-client — SessionContextClient.loginWithRedirect()
// ===========================================================================

describe("session-context-client SessionContextClient.loginWithRedirect", () => {
	it("navigates to the login URL with an explicit return URI", async () => {
		const environment = createPageLocationCapability(
			"https://app.example.com/protected",
		);
		const client = SessionContextClient.fromEnvironmentConfig({
			config: { baseUrl: "https://auth.example.com" },
			environment: createFoundationEnvironment({
				transport: {
					execute: vi.fn(async () => ({
						status: 204,
						headers: {},
						body: null,
					})),
				},
				router: environment,
				span: createRootSpan(),
				tracing: createTracing(),
			}),
		});

		const options: SessionLoginWithRedirectOptions = {
			postAuthRedirectUri: "https://app.example.com/dashboard",
		};
		await client.loginWithRedirect(options);

		expect(environment.location.href).toBe(
			"https://auth.example.com/auth/session/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Fdashboard",
		);
	});

	it("does not infer postAuthRedirectUri when omitted", async () => {
		const environment = createPageLocationCapability(
			"https://app.example.com/current-page",
		);
		const client = SessionContextClient.fromEnvironmentConfig({
			config: { baseUrl: "https://auth.example.com" },
			environment: createFoundationEnvironment({
				transport: {
					execute: vi.fn(async () => ({
						status: 204,
						headers: {},
						body: null,
					})),
				},
				router: environment,
				span: createRootSpan(),
				tracing: createTracing(),
			}),
		});
		await client.loginWithRedirect();

		expect(environment.location.href).toBe(
			"https://auth.example.com/auth/session/login",
		);
	});
});

// ===========================================================================
// 2. backend-oidc-mode — BackendOidcModeClient.loginWithRedirect()
// ===========================================================================

describe("backend-oidc-mode BackendOidcModeClient.loginWithRedirect", () => {
	it("resolves authorize URL from client and navigates through its router", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const environment = createPageLocationCapability(
			"https://app.example.com/page",
		);

		using client = BackendOidcModeClient.fromEnvironmentConfig({
			config: {
				baseUrl: "https://auth.example.com",
				defaultPostAuthRedirectUri: "https://app.example.com/callback",
			},
			environment: createFoundationEnvironment({
				span: createRootSpan(),
				tracing: createTracing(),
				persistentStorage,
				sessionStorage,
				router: environment,
			}),
		});

		await client.loginWithRedirect({
			postAuthRedirectUri: "https://app.example.com/return",
		});

		expect(environment.location.href).toBe(
			"https://auth.example.com/auth/oidc/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Freturn",
		);
	});

	it("uses the client default return URI when postAuthRedirectUri is omitted", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const environment = createPageLocationCapability(
			"https://app.example.com/page#fragment",
		);

		using client = BackendOidcModeClient.fromEnvironmentConfig({
			config: {
				baseUrl: "https://auth.example.com",
				defaultPostAuthRedirectUri: "https://app.example.com/default",
			},
			environment: createFoundationEnvironment({
				span: createRootSpan(),
				tracing: createTracing(),
				persistentStorage,
				sessionStorage,
				router: environment,
			}),
		});

		await client.loginWithRedirect();

		expect(environment.location.href).toBe(
			"https://auth.example.com/auth/oidc/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Fdefault",
		);
	});
});

// ===========================================================================
// 3. frontend-oidc-mode — FrontendOidcModeClient.loginWithRedirect()
// ===========================================================================

describe("frontend-oidc-mode FrontendOidcModeClient.loginWithRedirect", () => {
	it("builds the authorize URL, stores pending state, and navigates the browser", async () => {
		const sessionStorage = createInMemoryRecordStore();
		const environment = createPageLocationCapability(
			"https://app.example.com/page",
		);
		const runtime = createFoundationEnvironment({
			transport: {
				execute: vi.fn(async () => ({
					status: 200,
					headers: {},
					body: null,
				})),
			},
			time: {
				now: () => Date.now(),
				setTimeout: vi.fn((callback: () => void, delayMs: number) =>
					globalThis.setTimeout(callback, delayMs),
				),
				clearTimeout: vi.fn((handle: unknown) =>
					globalThis.clearTimeout(
						handle as ReturnType<typeof globalThis.setTimeout>,
					),
				),
			},
			sessionStorage,
			router: environment,
		});

		const { FrontendOidcModeClient } = await import(
			"@securitydept/token-set-context-client/frontend-oidc-mode"
		);

		using client = FrontendOidcModeClient.fromEnvironmentConfig({
			config: {
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/callback",
				// Provide endpoints to skip discovery.
				authorizationEndpoint: "https://auth.example.com/oauth2/authorize",
				tokenEndpoint: "https://auth.example.com/oauth2/token",
			},
			environment: runtime,
		});

		const options = {
			postAuthRedirectUri: "https://app.example.com/after-login",
		};
		await client.loginWithRedirect(options);

		// Should have navigated to the authorization endpoint.
		expect(environment.location.href).toContain(
			"https://auth.example.com/oauth2/authorize",
		);
		expect(environment.location.href).toContain("client_id=spa-client");
		expect(environment.location.href).toContain("code_challenge=");

		const authorizeUrl = new URL(environment.location.href);
		const state = authorizeUrl.searchParams.get("state");
		expect(state).toBeTruthy();

		const pendingKey = `securitydept.frontend_oidc.pending:${state}`;
		const pendingRaw = await sessionStorage.get(pendingKey);
		expect(pendingRaw).toBeTruthy();
	});
});
