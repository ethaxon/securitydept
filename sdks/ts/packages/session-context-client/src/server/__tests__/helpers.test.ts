// Server helper — focused unit tests for session-context-client

import type { HttpRequest, HttpResponse } from "@securitydept/client";
import { describe, expect, it } from "vitest";
import { createSessionServerHelper } from "../helpers";

/** Minimal mock transport for testing (avoids cross-package test-utils import). */
function mockTransport(handler: (req: HttpRequest) => HttpResponse): {
	execute: (req: HttpRequest) => Promise<HttpResponse>;
} {
	return {
		async execute(req: HttpRequest) {
			return handler(req);
		},
	};
}

describe("createSessionServerHelper", () => {
	describe("fetchUserInfo", () => {
		it("forwards request headers (cookies) to the transport", async () => {
			const transport = mockTransport((req) => {
				// Verify the cookie was forwarded.
				expect(req.headers?.cookie).toBe("session=abc123");
				return {
					status: 200,
					headers: {},
					body: {
						subject: "ssr-user-1",
						display_name: "SSR User",
						picture: null,
						claims: { role: "admin" },
					},
				};
			});

			const helper = createSessionServerHelper({
				config: { baseUrl: "https://auth.example.com" },
				transport,
			});

			const session = await helper.fetchUserInfo({
				headers: { cookie: "session=abc123" },
			});

			expect(session).not.toBeNull();
			expect(session?.principal.displayName).toBe("SSR User");
		});

		it("returns null when unauthenticated (401)", async () => {
			const transport = mockTransport(() => ({
				status: 401,
				headers: {},
				body: null,
			}));

			const helper = createSessionServerHelper({
				config: { baseUrl: "https://auth.example.com" },
				transport,
			});

			const session = await helper.fetchUserInfo({
				headers: { cookie: "" },
			});

			expect(session).toBeNull();
		});
	});

	describe("loginUrl", () => {
		it("generates login URL without browser globals", () => {
			const transport = mockTransport(() => ({
				status: 200,
				headers: {},
			}));
			const helper = createSessionServerHelper({
				config: { baseUrl: "https://auth.example.com" },
				transport,
			});

			const url = helper.loginUrl("/protected/page");
			expect(url).toBe(
				"https://auth.example.com/auth/session/login?post_auth_redirect_uri=%2Fprotected%2Fpage",
			);
		});

		it("generates login URL without post-auth redirect", () => {
			const transport = mockTransport(() => ({
				status: 200,
				headers: {},
			}));
			const helper = createSessionServerHelper({
				config: { baseUrl: "https://auth.example.com" },
				transport,
			});

			const url = helper.loginUrl();
			expect(url).toBe("https://auth.example.com/auth/session/login");
		});
	});

	describe("logoutUrl", () => {
		it("generates logout URL without browser globals", () => {
			const transport = mockTransport(() => ({
				status: 200,
				headers: {},
			}));
			const helper = createSessionServerHelper({
				config: { baseUrl: "https://auth.example.com" },
				transport,
			});

			const url = helper.logoutUrl();
			expect(url).toBe("https://auth.example.com/auth/session/logout");
		});
	});

	describe("client access", () => {
		it("exposes the underlying SessionContextClient", () => {
			const transport = mockTransport(() => ({
				status: 200,
				headers: {},
			}));
			const helper = createSessionServerHelper({
				config: { baseUrl: "https://auth.example.com" },
				transport,
			});

			expect(helper.client).toBeDefined();
		});
	});
});
