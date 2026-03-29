import { createRuntime } from "@securitydept/client";
import { createWebRuntime } from "@securitydept/client/web";
import { SessionContextClient } from "@securitydept/session-context-client";
import {
	createTokenSetBrowserClient,
	resolveTokenSetAuthorizeUrl,
} from "@securitydept/token-set-context-client/web";
import { describe, expect, it, vi } from "vitest";

describe("minimal entry points", () => {
	it("keeps foundation usage explicit about runtime ownership", async () => {
		const transport = {
			execute: vi.fn(async () => ({
				status: 200,
				headers: {},
				body: {
					principal: {
						displayName: "Alice",
					},
				},
			})),
		};

		const runtime = createRuntime({ transport });
		const client = new SessionContextClient({
			baseUrl: "https://auth.example.com",
		});

		const session = await client.fetchMe(runtime.transport);

		expect(session?.principal.displayName).toBe("Alice");
		expect(transport.execute).toHaveBeenCalledWith(
			expect.objectContaining({
				method: "GET",
				url: "https://auth.example.com/auth/session/me",
			}),
		);
	});

	it("supports a browser-oriented token-set entry path", () => {
		const client = createTokenSetBrowserClient({
			baseUrl: "https://auth.example.com",
			defaultPostAuthRedirectUri: "https://app.example.com/token-set",
			transport: {
				execute: vi.fn(async () => ({
					status: 200,
					headers: {},
					body: null,
				})),
			},
			persistentStore: {
				async get() {
					return null;
				},
				async set() {},
				async remove() {},
			},
			sessionStore: {
				async get() {
					return null;
				},
				async set() {},
				async remove() {},
			},
		});

		expect(
			resolveTokenSetAuthorizeUrl(client, {
				href: "https://app.example.com/token-set#callback",
			}),
		).toBe(
			"https://auth.example.com/auth/token-set/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Ftoken-set",
		);
	});

	it("keeps browser convenience optional in the foundation runtime", () => {
		const runtime = createWebRuntime({
			transport: {
				execute: vi.fn(async () => ({
					status: 204,
					headers: {},
					body: null,
				})),
			},
		});

		expect(typeof runtime.transport.execute).toBe("function");
		expect(typeof runtime.scheduler.setTimeout).toBe("function");
	});

	it("leaves SSR redirect assembly at the app boundary", () => {
		const sessionClient = new SessionContextClient({
			baseUrl: "https://auth.example.com",
		});

		expect(sessionClient.loginUrl("https://app.example.com/protected")).toBe(
			"https://auth.example.com/auth/session/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Fprotected",
		);
	});
});
