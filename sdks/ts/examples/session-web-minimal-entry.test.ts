// @vitest-environment jsdom

// Session-context browser minimal entry — standalone adopter-facing evidence
//
// This test proves the browser login redirect path on the environment-bound
// SessionContextClient root surface.
//
// It is intentionally self-contained: no shared helpers from multi-line
// convenience baselines. An adopter reading this file should understand
// "how do I start a session login from the browser?" in one glance.

import {
	createFoundationEnvironment,
	createRootSpan,
	createTracing,
	type RouterTrait,
} from "@securitydept/client";
import { createRouterForNativeWeb } from "@securitydept/client/web";
import {
	SessionContextClient,
	type SessionLoginWithRedirectOptions,
} from "@securitydept/session-context-client";
import { afterEach, describe, expect, it, vi } from "vitest";

function createPageLocationEnvironment(href: string): RouterTrait & {
	location: { href: string; hash: string; pathname: string; search: string };
} {
	const url = new URL(href);
	const location = {
		href,
		hash: url.hash,
		pathname: url.pathname,
		search: url.search,
	};
	return {
		...createRouterForNativeWeb({ location }),
		location,
	};
}

describe("session-context browser minimal entry", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("shows the standalone browser entry path: loginWithRedirect navigates with explicit return URI", async () => {
		// 1. Create a session client with a router-backed browser environment.
		const environment = createPageLocationEnvironment(
			"https://app.example.com/protected-page",
		);
		const client = new SessionContextClient(
			{ baseUrl: "https://auth.example.com" },
			createFoundationEnvironment({
				transport: {
					execute: async () => ({ status: 204, headers: {}, body: null }),
				},
				router: environment,
				span: createRootSpan(),
				tracing: createTracing(),
			}),
		);

		// 3. Trigger login redirect with explicit options.
		const options: SessionLoginWithRedirectOptions = {
			postAuthRedirectUri: "https://app.example.com/dashboard",
		};
		await client.loginWithRedirect(options);

		// 4. Verify the browser navigated to the login URL.
		expect(environment.location.href).toBe(
			"https://auth.example.com/auth/session/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Fdashboard",
		);
	});

	it("shows the default-options path: no implicit post-auth redirect", async () => {
		const environment = createPageLocationEnvironment(
			"https://app.example.com/current-page",
		);
		const client = new SessionContextClient(
			{ baseUrl: "https://auth.example.com" },
			createFoundationEnvironment({
				transport: {
					execute: async () => ({ status: 204, headers: {}, body: null }),
				},
				router: environment,
				span: createRootSpan(),
				tracing: createTracing(),
			}),
		);

		await client.loginWithRedirect();

		expect(environment.location.href).toBe(
			"https://auth.example.com/auth/session/login",
		);
	});

	it("SessionLoginWithRedirectOptions is importable as a named type from root", () => {
		const options: SessionLoginWithRedirectOptions = {
			postAuthRedirectUri: "https://app.example.com/after-login",
		};
		expect(options.postAuthRedirectUri).toBeTruthy();
	});
});
