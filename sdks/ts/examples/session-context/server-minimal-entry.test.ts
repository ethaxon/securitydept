// Session server minimal entry — standalone adopter-facing evidence
//
// This test proves the standalone server-host entry path for
// session-context-client using @securitydept/client/server host adapters.
//
// An adopter reading this file should understand "how do I use
// session helpers in a server request handler?" in one glance.

import {
	type CreateEnvironmentForServerOptions,
	createEnvironmentForServer,
} from "@securitydept/client/server";
import { SessionContextClient } from "@securitydept/session-context-client";
import { describe, expect, it, vi } from "vitest";

describe("session server minimal entry", () => {
	it("shows the standalone server entry path: helper construction → session probe", async () => {
		// 1. Create a mock transport that simulates an unauthenticated response.
		const transport = {
			execute: vi.fn(async () => ({
				status: 401,
				headers: {},
				body: null, // 401 = not authenticated
			})),
		};

		// 2. Create a request-scoped server environment and session client.
		const options: CreateEnvironmentForServerOptions = {
			transport: transport,
			request: {
				headers: { cookie: "session_id=abc123" },
			},
		};
		const client = SessionContextClient.fromEnvironmentConfig({
			config: { baseUrl: "https://auth.example.com" },
			environment: createEnvironmentForServer(options),
		});

		// 3. Probe the session with forwarded cookies.
		const session = await client.refresh();

		// 4. No session. Redirect response construction belongs to the server
		//    host/router layer, not SessionContextClient.
		expect(session).toBeNull();

		// 5. Verify the transport received the forwarded cookie header.
		expect(transport.execute).toHaveBeenCalledWith(
			expect.objectContaining({
				headers: expect.objectContaining({
					cookie: "session_id=abc123",
				}),
			}),
		);
	});

	it("shows the authenticated path: refresh returns session info", async () => {
		const transport = {
			execute: vi.fn(async () => ({
				status: 200,
				headers: {},
				body: {
					principal: {
						subject: "session-user-1",
						displayName: "Alice",
						email: "alice@example.com",
					},
				},
			})),
		};

		const client = SessionContextClient.fromEnvironmentConfig({
			config: { baseUrl: "https://auth.example.com" },
			environment: createEnvironmentForServer({
				transport: transport,
				request: { headers: { cookie: "session_id=valid" } },
			}),
		});

		const session = await client.refresh();

		// Authenticated — the host can use the session info to render the page.
		expect(session).not.toBeNull();
		expect(session?.principal.displayName).toBe("Alice");
	});
});
