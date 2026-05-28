import {
	createFoundationEnvironment,
	createRootSpan,
	createTracing,
} from "@securitydept/client";
import { createRouterForNativeWeb } from "@securitydept/client/web";
import { SessionContextClient } from "@securitydept/session-context-client";
import { BackendOidcModeClient } from "@securitydept/token-set-context-client/backend-oidc-mode";
import { describe, expect, it, vi } from "vitest";

describe("minimal entry points", () => {
	it("keeps foundation usage explicit about environment ownership", async () => {
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

		const environment = createFoundationEnvironment({
			transport: transport,
			span: createRootSpan(),
			tracing: createTracing(),
		});
		const client = new SessionContextClient({
			baseUrl: "https://auth.example.com",
		});

		const session = await client.fetchUserInfo(environment.transport);

		expect(session?.principal.displayName).toBe("Alice");
		expect(transport.execute).toHaveBeenCalledWith(
			expect.objectContaining({
				method: "GET",
				url: "https://auth.example.com/auth/session/user-info",
			}),
		);
	});

	it("supports a browser-oriented token-set entry path", () => {
		const client = new BackendOidcModeClient(
			{
				baseUrl: "https://auth.example.com",
				defaultPostAuthRedirectUri: "https://app.example.com/oidc-mediated",
			},
			createFoundationEnvironment({
				span: createRootSpan(),
				tracing: createTracing(),
				transport: {
					execute: vi.fn(async () => ({
						status: 200,
						headers: {},
						body: null,
					})),
				},
				persistentStorage: {
					async get() {
						return null;
					},
					async set() {},
					async remove() {},
				},
				sessionStorage: {
					async get() {
						return null;
					},
					async take() {
						return null;
					},
					async set() {},
					async remove() {},
				},
			}),
		);
		const router = createRouterForNativeWeb({
			location: {
				href: "https://app.example.com/oidc-mediated#callback",
				hash: "#callback",
			},
		});

		expect(client.authorizeUrl(router.currentUrl()?.toString())).toBe(
			"https://auth.example.com/auth/oidc/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Foidc-mediated%23callback",
		);
	});

	it("allows adopter-specific path overrides via browser entry", () => {
		// securitydept-server uses /auth/token-set/* instead of the SDK
		// default /auth/oidc/*. Adopters must be able to pass these overrides
		// through the browser convenience entry.
		const client = new BackendOidcModeClient(
			{
				baseUrl: "https://auth.example.com",
				loginPath: "/auth/token-set/login",
				refreshPath: "/auth/token-set/refresh",
				metadataRedeemPath: "/auth/token-set/metadata/redeem",
				userInfoPath: "/auth/token-set/user-info",
			},
			createFoundationEnvironment({
				span: createRootSpan(),
				tracing: createTracing(),
				transport: {
					execute: vi.fn(async () => ({
						status: 200,
						headers: {},
						body: null,
					})),
				},
				persistentStorage: {
					async get() {
						return null;
					},
					async set() {},
					async remove() {},
				},
				sessionStorage: {
					async get() {
						return null;
					},
					async take() {
						return null;
					},
					async set() {},
					async remove() {},
				},
			}),
		);
		const router = createRouterForNativeWeb({
			location: {
				href: "https://app.example.com/dashboard",
				hash: "",
			},
		});

		expect(client.authorizeUrl(router.currentUrl()?.toString())).toBe(
			"https://auth.example.com/auth/token-set/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Fdashboard",
		);
	});

	it("keeps browser convenience optional in the foundation environment", () => {
		const environment = createFoundationEnvironment({
			transport: {
				execute: vi.fn(async () => ({
					status: 204,
					headers: {},
					body: null,
				})),
			},
			span: createRootSpan(),
			tracing: createTracing(),
		});

		expect(typeof environment.transport.execute).toBe("function");
		expect(typeof environment.time.setTimeout).toBe("function");
		expect(typeof environment.time.clearTimeout).toBe("function");
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
