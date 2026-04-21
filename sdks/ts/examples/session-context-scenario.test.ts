import { createInMemoryRecordStore } from "@securitydept/client";
import { SessionContextClient } from "@securitydept/session-context-client";
import { FakeTransport } from "@securitydept/test-utils";
import { describe, expect, it } from "vitest";

describe("external session context scenario", () => {
	it("supports login URL construction, session fetch, and logout without app glue", async () => {
		const sessionStore = createInMemoryRecordStore();
		const transport = new FakeTransport()
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
			{ sessionStore },
		);

		await client.savePendingLoginRedirect("https://app.example.com/dashboard");

		expect(client.loginUrl("https://app.example.com/dashboard")).toBe(
			"https://auth.example.com/auth/session/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Fdashboard",
		);
		expect(await client.loadPendingLoginRedirect()).toBe(
			"https://app.example.com/dashboard",
		);

		const session = await client.fetchUserInfo(transport);

		expect(session?.principal.displayName).toBe("Alice");
		expect(session?.principal.picture).toBe(
			"https://cdn.example.com/alice.png",
		);

		await client.logout(transport);

		expect(await client.consumePendingLoginRedirect()).toBe(
			"https://app.example.com/dashboard",
		);
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
