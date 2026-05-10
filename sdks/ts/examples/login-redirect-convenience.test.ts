import {
	createInMemoryRecordStore,
	type PageLocationCapability,
} from "@securitydept/client";
import { SessionContextClient } from "@securitydept/session-context-client";
import type { LoginWithRedirectOptions } from "@securitydept/session-context-client/web";
import { loginWithRedirect } from "@securitydept/session-context-client/web";
import type { LoginWithBackendOidcRedirectOptions } from "@securitydept/token-set-context-client/backend-oidc-mode/web";
import {
	createBackendOidcModeWebClient,
	createBackendOidcModeWebClientEnvironment,
	loginWithBackendOidcRedirect,
} from "@securitydept/token-set-context-client/backend-oidc-mode/web";
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createPageLocationCapability(href: string): PageLocationCapability {
	const url = new URL(href);
	return {
		location: {
			href,
			hash: url.hash,
			pathname: url.pathname,
			search: url.search,
		},
	};
}

// ===========================================================================
// 1. session-context-client/web — loginWithRedirect
// ===========================================================================

describe("session-context-client/web loginWithRedirect", () => {
	it("saves the pending redirect URI and navigates to the login URL", async () => {
		const sessionStore = createInMemoryRecordStore();
		const client = new SessionContextClient(
			{ baseUrl: "https://auth.example.com" },
			{ sessionStore },
		);

		const environment = createPageLocationCapability(
			"https://app.example.com/protected",
		);
		const options: LoginWithRedirectOptions = {
			environment,
			postAuthRedirectUri: "https://app.example.com/dashboard",
		};
		await loginWithRedirect(client, options);

		expect(environment.location.href).toBe(
			"https://auth.example.com/auth/session/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Fdashboard",
		);

		// Should have saved the pending redirect.
		expect(await client.loadPendingLoginRedirect()).toBe(
			"https://app.example.com/dashboard",
		);
	});

	it("defaults postAuthRedirectUri to window.location.href when omitted", async () => {
		const sessionStore = createInMemoryRecordStore();
		const client = new SessionContextClient(
			{ baseUrl: "https://auth.example.com" },
			{ sessionStore },
		);

		const environment = createPageLocationCapability(
			"https://app.example.com/current-page",
		);
		await loginWithRedirect(client, { environment });

		expect(environment.location.href).toBe(
			"https://auth.example.com/auth/session/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Fcurrent-page",
		);

		// Pending redirect should contain the current page.
		expect(await client.loadPendingLoginRedirect()).toBe(
			"https://app.example.com/current-page",
		);
	});
});

// ===========================================================================
// 2. backend-oidc-mode/web — loginWithBackendOidcRedirect
// ===========================================================================

describe("backend-oidc-mode/web loginWithBackendOidcRedirect", () => {
	it("resolves authorize URL from client and navigates the window", () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();

		const client = createBackendOidcModeWebClient({
			environment: createBackendOidcModeWebClientEnvironment({
				persistentStore,
				sessionStore,
			}),
			baseUrl: "https://auth.example.com",
			defaultPostAuthRedirectUri: "https://app.example.com/callback",
		});

		const environment = createPageLocationCapability(
			"https://app.example.com/page",
		);
		const options: LoginWithBackendOidcRedirectOptions = {
			environment,
			postAuthRedirectUri: "https://app.example.com/return",
		};
		loginWithBackendOidcRedirect(client, options);

		expect(environment.location.href).toBe(
			"https://auth.example.com/auth/oidc/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Freturn",
		);

		client.dispose();
	});

	it("derives return URI from location when postAuthRedirectUri is omitted", () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();

		const client = createBackendOidcModeWebClient({
			environment: createBackendOidcModeWebClientEnvironment({
				persistentStore,
				sessionStore,
			}),
			baseUrl: "https://auth.example.com",
		});

		const environment = createPageLocationCapability(
			"https://app.example.com/page#fragment",
		);
		loginWithBackendOidcRedirect(client, { environment });

		expect(environment.location.href).toContain(
			"https://auth.example.com/auth/oidc/login?post_auth_redirect_uri=",
		);
		const urlObj = new URL(environment.location.href);
		const redirectUri = urlObj.searchParams.get("post_auth_redirect_uri");
		expect(redirectUri).not.toContain("#fragment");
		expect(redirectUri).toContain("https://app.example.com/page");

		client.dispose();
	});
});

// ===========================================================================
// 3. frontend-oidc-mode — FrontendOidcModeClient.loginWithRedirect()
// ===========================================================================

describe("frontend-oidc-mode FrontendOidcModeClient.loginWithRedirect", () => {
	it("builds the authorize URL, stores pending state, and navigates the browser", async () => {
		const sessionStore = createInMemoryRecordStore();
		const runtime = {
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
			clock: { now: () => Date.now() },
			sessionStore,
		};

		const { FrontendOidcModeClient } = await import(
			"@securitydept/token-set-context-client/frontend-oidc-mode"
		);
		type FrontendOidcModeLoginWithRedirectOptions =
			import("@securitydept/token-set-context-client/frontend-oidc-mode").FrontendOidcModeLoginWithRedirectOptions;

		const client = new FrontendOidcModeClient(
			{
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/callback",
				// Provide endpoints to skip discovery.
				authorizationEndpoint: "https://auth.example.com/oauth2/authorize",
				tokenEndpoint: "https://auth.example.com/oauth2/token",
			},
			runtime,
		);

		const environment = createPageLocationCapability(
			"https://app.example.com/page",
		);

		const options: FrontendOidcModeLoginWithRedirectOptions = {
			environment,
			postAuthRedirectUri: "https://app.example.com/after-login",
			extraParams: { prompt: "consent" },
		};
		const invalidOptions = {
			postAuthRedirectUri: "https://app.example.com/after-login",
		};
		// @ts-expect-error frontend-oidc redirect helpers require explicit page environment.
		const _invalid: FrontendOidcModeLoginWithRedirectOptions = invalidOptions;
		void _invalid;
		await client.loginWithRedirect(options);

		// Should have navigated to the authorization endpoint.
		expect(environment.location.href).toContain(
			"https://auth.example.com/oauth2/authorize",
		);
		expect(environment.location.href).toContain("client_id=spa-client");
		expect(environment.location.href).toContain("prompt=consent");
		expect(environment.location.href).toContain("code_challenge=");

		const authorizeUrl = new URL(environment.location.href);
		const state = authorizeUrl.searchParams.get("state");
		expect(state).toBeTruthy();

		const pendingKey = `securitydept.frontend_oidc.pending:${state}`;
		const pendingRaw = await sessionStore.get(pendingKey);
		expect(pendingRaw).toBeTruthy();

		client.dispose();
	});
});
