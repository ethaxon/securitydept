// SSR / Server-Host Helper Baseline — Contract Evidence
//
// This file demonstrates server-host flows without browser globals. Basic auth
// and session context use @securitydept/client/server to create request-scoped
// environments passed directly to their clients.

import {
	AuthGuardResultKind,
	BasicAuthContextClient,
} from "@securitydept/basic-auth-context-client";
import { createEnvironmentForServer } from "@securitydept/client/server";
import { createTransportForTest } from "@securitydept/client/test";
import { SessionContextClient } from "@securitydept/session-context-client";
import { describe, expect, it } from "vitest";

// ===========================================================================
// 1. basic-auth-context — server-host flow
// ===========================================================================

describe("basic-auth root client — server-host flow", () => {
	it("produces a redirect instruction from a server request context", () => {
		const client = new BasicAuthContextClient(
			{
				baseUrl: "https://auth.example.com",
				zones: [{ zonePrefix: "/api" }],
			},
			createEnvironmentForServer({
				transport: createTransportForTest(),
				request: { headers: {} },
			}),
		);

		// Simulate: server receives a 401 from upstream for /api/data.
		const redirect = client.handleUnauthorized("/api/data", 401);

		// The helper produces a framework-neutral redirect instruction.
		expect(redirect.kind).toBe(AuthGuardResultKind.Redirect);
		if (redirect.kind === AuthGuardResultKind.Redirect) {
			expect(redirect.status).toBe(302);
			expect(redirect.location).toContain("/api/login");
			expect(redirect.location).toContain("post_auth_redirect_uri");
		}

		// The host uses this to construct its framework response:
		//   return Response.redirect(redirect.location, redirect.status);
	});

	it("returns null for paths outside zones", () => {
		const client = new BasicAuthContextClient(
			{
				baseUrl: "https://auth.example.com",
				zones: [{ zonePrefix: "/api" }],
			},
			createEnvironmentForServer({
				transport: createTransportForTest(),
				request: { headers: {} },
			}),
		);

		const redirect = client.handleUnauthorized("/public", 401);
		expect(redirect.kind).toBe(AuthGuardResultKind.Ok);
	});
});

// ===========================================================================
// 2. session-context — server-host flow with cookie forwarding
// ===========================================================================

describe("session server environment — server-host flow with cookie forwarding", () => {
	it("fetchUserInfo forwards cookies and returns session info", async () => {
		const transport = createTransportForTest().on(
			(req) => req.method === "GET" && req.url.endsWith("/user-info"),
			(req) => {
				// Verify cookie was forwarded from the server request.
				expect(req.headers?.cookie).toBe("session_id=xyz789");
				return {
					status: 200,
					headers: {},
					body: {
						subject: "session-user-server",
						display_name: "Server User",
						picture: null,
						claims: { org: "acme" },
					},
				};
			},
		);

		// Simulate: server extracts cookies from incoming request.
		const client = new SessionContextClient(
			{ baseUrl: "https://auth.example.com" },
			createEnvironmentForServer({
				transport,
				request: { headers: { cookie: "session_id=xyz789" } },
			}),
		);
		const session = await client.refresh();

		expect(session).not.toBeNull();
		expect(session?.principal.displayName).toBe("Server User");
		expect(session?.principal.claims).toEqual({ org: "acme" });
	});

	it("keeps redirect response construction outside SessionContextClient", async () => {
		const transport = createTransportForTest().on(
			(req) => req.method === "GET" && req.url.endsWith("/user-info"),
			() => ({ status: 401, headers: {}, body: null }),
		);

		const client = new SessionContextClient(
			{ baseUrl: "https://auth.example.com" },
			createEnvironmentForServer({
				transport,
				request: { headers: {} },
			}),
		);
		const session = await client.refresh();
		expect(session).toBeNull();
		expect("loginUrl" in client).toBe(false);
	});
});
