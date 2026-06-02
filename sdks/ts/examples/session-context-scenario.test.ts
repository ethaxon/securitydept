import { createFoundationEnvironment } from "@securitydept/client";
import { SessionContextClient } from "@securitydept/session-context-client";
import { createTransportForTest } from "@securitydept/client/test";
import { describe, expect, it } from "vitest";

describe("external session context scenario", () => {
	it("supports session fetch and logout without app glue", async () => {
		const transport = createTransportForTest()
			.on(
				(request) =>
					request.method === "GET" && request.url.endsWith("/user-info"),
				() => ({
					status: 200,
					headers: {},
					body: {
						subject: "session-user-1",
						display_name: "Alice",
						picture: "https://cdn.example.com/alice.png",
					},
				}),
			)
			.on(
				(request) =>
					request.method === "POST" && request.url.endsWith("/logout"),
				() => ({
					status: 204,
					headers: {},
					body: null,
				}),
			);
		const client = new SessionContextClient(
			{ baseUrl: "https://auth.example.com" },
			createFoundationEnvironment({
				transport,
			}),
		);

		const session = await client.refresh();

		expect(session?.principal.displayName).toBe("Alice");
		expect(session?.principal.picture).toBe(
			"https://cdn.example.com/alice.png",
		);

		await client.logout();

		expect(transport.history).toEqual([
			expect.objectContaining({
				method: "GET",
				url: "https://auth.example.com/auth/session/user-info",
			}),
			expect.objectContaining({
				method: "POST",
				url: "https://auth.example.com/auth/session/logout",
			}),
		]);
	});
});
