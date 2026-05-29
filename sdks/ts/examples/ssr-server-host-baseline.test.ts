// SSR / Server-Host Baseline — Contract Evidence
//
// This file establishes the TS SDK's consumption contract when used in an
// SSR / server-render host (Next.js, Remix, Astro, plain Node request
// handler, etc.).
//
// Key architectural boundary:
//   - The SDK provides **transport-bound operations** (refresh, logout).
//   - The host owns **HTTP response construction** (302 redirect headers,
//     Set-Cookie, response body rendering).
//   - Redirect navigation belongs to a server router host capability, not to
//     per-client URL builder methods.
//
// This test verifies that every SSR-relevant operation is available from
// the root (non-/web) subpath and produces values the server host can
// directly embed in its HTTP response.
//
// Stability: contract-level evidence

import {
	AuthGuardResultKind,
	BasicAuthContextClient,
} from "@securitydept/basic-auth-context-client";
import {
	createFoundationEnvironment,
	createInMemoryRecordStore,
} from "@securitydept/client";
import { SessionContextClient } from "@securitydept/session-context-client";
import { FakeTransport } from "@securitydept/test-utils";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// 1. session-context-client — SSR session operations
// ---------------------------------------------------------------------------

describe("session-context-client SSR / server-host contract", () => {
	it("does not expose URL builder methods for server-side redirect assembly", () => {
		const client = new SessionContextClient(
			{
				baseUrl: "https://auth.example.com",
			},
			createFoundationEnvironment({
				transport: new FakeTransport(),
			}),
		);

		expect("loginUrl" in client).toBe(false);
		expect("logoutUrl" in client).toBe(false);
	});

	it("fetchUserInfo() works against server-forwarded cookies via arbitrary transport", async () => {
		// In SSR, the host forwards the user's cookies via a custom transport
		// that injects Cookie headers.  The SDK does NOT own cookie handling.
		const transport = new FakeTransport().on(
			(request) =>
				request.method === "GET" && request.url.endsWith("/user-info"),
			(request) => {
				// Verify the host forwarded the cookie header.
				expect(request.headers?.cookie).toBe("session=abc123");
				return {
					status: 200,
					headers: {},
					body: {
						subject: "session-user-ssr",
						display_name: "SSR User",
						picture: null,
						claims: { role: "viewer" },
					},
				};
			},
		);

		// The host wraps the transport to forward cookies.
		const ssrTransport = {
			async execute(request: import("@securitydept/client").HttpRequest) {
				return transport.execute({
					...request,
					headers: {
						...request.headers,
						cookie: "session=abc123",
					},
				});
			},
		};
		const client = new SessionContextClient(
			{
				baseUrl: "https://auth.example.com",
			},
			createFoundationEnvironment({
				transport: ssrTransport,
			}),
		);

		const session = await client.refresh();
		expect(session?.principal.displayName).toBe("SSR User");
		expect(session?.principal.claims).toEqual({ role: "viewer" });
	});

	it("fetchUserInfo() returns null when unauthenticated, enabling server-side redirect", async () => {
		const transport = new FakeTransport().on(
			(request) =>
				request.method === "GET" && request.url.endsWith("/user-info"),
			() => ({ status: 401, headers: {}, body: null }),
		);

		const client = new SessionContextClient(
			{
				baseUrl: "https://auth.example.com",
			},
			createFoundationEnvironment({
				transport,
			}),
		);

		const session = await client.refresh();
		expect(session).toBeNull();

		// Example SSR handler pattern:
		//   if (!session) {
		//     return serverRouter.navigate({ url, intent: "auth_redirect" });
		//   }
		expect("loginUrl" in client).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 2. basic-auth-context-client — SSR zone-based redirect contract
// ---------------------------------------------------------------------------

describe("basic-auth-context-client SSR / server-host contract", () => {
	it("handleUnauthorized() produces zone-matched redirect URLs without browser dependency", () => {
		const client = new BasicAuthContextClient(
			{
				baseUrl: "https://auth.example.com",
				zones: [{ zonePrefix: "/api" }],
			},
			createFoundationEnvironment({
				transport: {
					async execute() {
						throw new Error("Unexpected transport call.");
					},
				},
			}),
		);

		// In SSR, the host uses handleUnauthorized() after a backend 401.
		const result = client.handleUnauthorized("/api/protected", 401);

		expect(result.kind).toBe(AuthGuardResultKind.Redirect);

		if (result.kind === AuthGuardResultKind.Redirect) {
			// The host can directly use this URL in a 302 response.
			expect(result.location).toContain("https://auth.example.com/api/login");
			expect(result.location).toContain(
				"post_auth_redirect_uri=%2Fapi%2Fprotected",
			);
		}
	});

	it("returns Ok for paths outside configured zones (no redirect needed)", () => {
		const client = new BasicAuthContextClient(
			{
				baseUrl: "https://auth.example.com",
				zones: [{ zonePrefix: "/api" }],
			},
			createFoundationEnvironment({
				transport: {
					async execute() {
						throw new Error("Unexpected transport call.");
					},
				},
			}),
		);

		const result = client.handleUnauthorized("/public/health", 401);
		expect(result.kind).toBe(AuthGuardResultKind.Ok);
	});
});

// ---------------------------------------------------------------------------
// 3. backend-oidc-mode — SSR contract
// ---------------------------------------------------------------------------

describe("backend-oidc-mode SSR / server-host contract", () => {
	it("authorizeUrl() produces a redirect target for SSR without browser globals", async () => {
		// In SSR context, the host constructs the client from root subpath
		// (NOT /web).  No browser globals needed.
		const { BackendOidcModeClient } = await import(
			"@securitydept/token-set-context-client/backend-oidc-mode"
		);

		const sessionStorage = createInMemoryRecordStore();
		const client = new BackendOidcModeClient(
			{
				baseUrl: "https://auth.example.com",
				defaultPostAuthRedirectUri: "https://app.example.com/callback",
			},
			createFoundationEnvironment({
				transport: {
					execute: async () => ({
						status: 200,
						headers: {},
						body: null,
					}),
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
				persistentStorage: sessionStorage,
			}),
		);

		const authorizeTarget = client.authorizeUrl(
			"https://app.example.com/protected",
		);

		expect(authorizeTarget).toBe(
			"https://auth.example.com/auth/oidc/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Fprotected",
		);

		// Example SSR handler (pseudocode):
		//   return Response.redirect(authorizeTarget, 302);

		client.dispose();
	});
});
