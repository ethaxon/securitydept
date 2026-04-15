// Session server minimal entry — standalone adopter-facing evidence
//
// This test proves the standalone server-host entry path for
// session-context-client, exercising the canonical import surface
// from @securitydept/session-context-client/server.
//
// An adopter reading this file should understand "how do I use
// session helpers in a server request handler?" in one glance.

import type { CreateSessionServerHelperOptions } from "@securitydept/session-context-client/server";
import { createSessionServerHelper } from "@securitydept/session-context-client/server";
import { describe, expect, it, vi } from "vitest";

describe("session server minimal entry", () => {
	it("shows the standalone server entry path: helper construction → fetchUserInfo → login redirect", async () => {
		// 1. Create a mock transport that simulates an unauthenticated response.
		const transport = {
			execute: vi.fn(async () => ({
				status: 401,
				headers: {},
				body: null, // 401 = not authenticated
			})),
		};

		// 2. Create a server helper.
		const options: CreateSessionServerHelperOptions = {
			config: { baseUrl: "https://auth.example.com" },
			transport,
		};
		const helper = createSessionServerHelper(options);

		// 3. Probe the session with forwarded cookies.
		const session = await helper.fetchUserInfo({
			headers: { cookie: "session_id=abc123" },
		});

		// 4. No session → generate a login redirect URL.
		//    The host (Next.js, Remix, Express, etc.) uses this URL
		//    to construct its own redirect response.
		expect(session).toBeNull();

		const loginUrl = helper.loginUrl("/protected/page");
		expect(loginUrl).toContain("https://auth.example.com/auth/session/login");
		expect(loginUrl).toContain("post_auth_redirect_uri=");

		// 5. Verify the transport received the forwarded cookie header.
		expect(transport.execute).toHaveBeenCalledWith(
			expect.objectContaining({
				headers: expect.objectContaining({
					cookie: "session_id=abc123",
				}),
			}),
		);
	});

	it("shows the authenticated path: fetchUserInfo returns session info", async () => {
		const transport = {
			execute: vi.fn(async () => ({
				status: 200,
				headers: {},
				body: {
					principal: { displayName: "Alice", email: "alice@example.com" },
				},
			})),
		};

		const helper = createSessionServerHelper({
			config: { baseUrl: "https://auth.example.com" },
			transport,
		});

		const session = await helper.fetchUserInfo({
			headers: { cookie: "session_id=valid" },
		});

		// Authenticated — the host can use the session info to render the page.
		expect(session).not.toBeNull();
		expect(session?.principal.displayName).toBe("Alice");
	});

	it("shows logoutUrl for server-side URL generation", () => {
		const helper = createSessionServerHelper({
			config: { baseUrl: "https://auth.example.com" },
			transport: { execute: vi.fn() },
		});

		const logoutUrl = helper.logoutUrl();
		expect(logoutUrl).toContain("https://auth.example.com/auth/session/logout");
	});
});
