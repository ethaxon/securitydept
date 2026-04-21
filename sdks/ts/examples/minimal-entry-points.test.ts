import { createRuntime } from "@securitydept/client";
import { createWebRuntime } from "@securitydept/client/web";
import { SessionContextClient } from "@securitydept/session-context-client";
import {
	buildAuthorizeUrlReturningToCurrent,
	createBackendOidcModeBrowserClient,
} from "@securitydept/token-set-context-client/backend-oidc-mode/web";
import { describe, expect, it, vi } from "vitest";

describe("minimal entry points", () => {
	it("keeps foundation usage explicit about runtime ownership", async () => {
		const transport = {
			execute: vi.fn(async () => ({
				status: 200,
				headers: {},
				body: {
					principal: {
						subject: "session-user-1",
						displayName: "Alice",
					},
				},
			})),
		};

		const runtime = createRuntime({ transport });
		const client = new SessionContextClient({
			baseUrl: "https://auth.example.com",
		});

		const session = await client.fetchUserInfo(runtime.transport);

		expect(session?.principal.displayName).toBe("Alice");
		expect(transport.execute).toHaveBeenCalledWith(
			expect.objectContaining({
				method: "GET",
				url: "https://auth.example.com/auth/session/user-info",
			}),
		);
	});

	it("supports a browser-oriented token-set entry path", () => {
		const client = createBackendOidcModeBrowserClient({
			baseUrl: "https://auth.example.com",
			defaultPostAuthRedirectUri: "https://app.example.com/oidc-mediated",
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
			buildAuthorizeUrlReturningToCurrent(client, {
				href: "https://app.example.com/oidc-mediated#callback",
			}),
		).toBe(
			"https://auth.example.com/auth/oidc/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Foidc-mediated",
		);
	});

	it("allows adopter-specific path overrides via browser entry", () => {
		// securitydept-server uses /auth/token-set/* instead of the SDK
		// default /auth/oidc/*. Adopters must be able to pass these overrides
		// through the browser convenience entry.
		const client = createBackendOidcModeBrowserClient({
			baseUrl: "https://auth.example.com",
			loginPath: "/auth/token-set/login",
			refreshPath: "/auth/token-set/refresh",
			metadataRedeemPath: "/auth/token-set/metadata/redeem",
			userInfoPath: "/auth/token-set/user-info",
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
			buildAuthorizeUrlReturningToCurrent(client, {
				href: "https://app.example.com/dashboard",
			}),
		).toBe(
			"https://auth.example.com/auth/token-set/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Fdashboard",
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
