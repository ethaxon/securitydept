// SSR / Server-Host Helper Baseline — Contract Evidence
//
// This file demonstrates that the server helpers for both basic-auth-context
// and session-context can drive real server-host flows without browser globals.

import { createBasicAuthServerHelper } from "@securitydept/basic-auth-context-client/server";
import { createSessionServerHelper } from "@securitydept/session-context-client/server";
import { FakeTransport } from "@securitydept/test-utils";
import { describe, expect, it } from "vitest";

// ===========================================================================
// 1. basic-auth-context — server-host flow
// ===========================================================================

describe("basic-auth server helper — server-host flow", () => {
	it("produces a redirect instruction from a server request context", () => {
		const helper = createBasicAuthServerHelper({
			config: {
				baseUrl: "https://auth.example.com",
				zones: [{ zonePrefix: "/api" }],
			},
		});

		// Simulate: server receives a 401 from upstream for /api/data.
		const redirect = helper.handleUnauthorized({ path: "/api/data" });

		// The helper produces a framework-neutral redirect instruction.
		expect(redirect).not.toBeNull();
		expect(redirect?.statusCode).toBe(302);
		expect(redirect?.destination).toContain("/api/login");
		expect(redirect?.destination).toContain("post_auth_redirect_uri");

		// The host uses this to construct its framework response:
		//   return Response.redirect(redirect.destination, redirect.statusCode);
	});

	it("returns null for paths outside zones", () => {
		const helper = createBasicAuthServerHelper({
			config: {
				baseUrl: "https://auth.example.com",
				zones: [{ zonePrefix: "/api" }],
			},
		});

		const redirect = helper.handleUnauthorized({ path: "/public" });
		expect(redirect).toBeNull();
	});
});

// ===========================================================================
// 2. session-context — server-host flow with cookie forwarding
// ===========================================================================

describe("session server helper — server-host flow with cookie forwarding", () => {
	it("fetchUserInfo forwards cookies and returns session info", async () => {
		const transport = new FakeTransport().on(
			(req) => req.method === "GET" && req.url.endsWith("/user-info"),
			(req) => {
				// Verify cookie was forwarded from the server request.
				expect(req.headers?.cookie).toBe("session_id=xyz789");
				return {
					status: 200,
					headers: {},
					body: {
						display_name: "Server User",
						picture: null,
						claims: { org: "acme" },
					},
				};
			},
		);

		const helper = createSessionServerHelper({
			config: { baseUrl: "https://auth.example.com" },
			transport,
		});

		// Simulate: server extracts cookies from incoming request.
		const session = await helper.fetchUserInfo({
			headers: { cookie: "session_id=xyz789" },
		});

		expect(session).not.toBeNull();
		expect(session?.principal.displayName).toBe("Server User");
		expect(session?.principal.claims).toEqual({ org: "acme" });
	});

	it("produces login redirect URL when unauthenticated", async () => {
		const transport = new FakeTransport().on(
			(req) => req.method === "GET" && req.url.endsWith("/user-info"),
			() => ({ status: 401, headers: {}, body: null }),
		);

		const helper = createSessionServerHelper({
			config: { baseUrl: "https://auth.example.com" },
			transport,
		});

		const session = await helper.fetchUserInfo({ headers: {} });
		expect(session).toBeNull();

		// Host builds a redirect response.
		const loginTarget = helper.loginUrl("/protected/dashboard");
		expect(loginTarget).toContain("/auth/session/login");
		expect(loginTarget).toContain("post_auth_redirect_uri");
	});
});
