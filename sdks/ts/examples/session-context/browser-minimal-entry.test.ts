// @vitest-environment jsdom

// Session-context browser minimal entry — standalone adopter-facing evidence
//
// This test proves the browser login redirect path on the environment-bound
// SessionContextClient root surface.
//
// It is intentionally self-contained: no shared helpers from multi-line
// convenience baselines. An adopter reading this file should understand
// "how do I start a session login from the browser?" in one glance.

import { createEnvironmentForNativeWeb } from "@securitydept/client/web";
import { SessionContextClient } from "@securitydept/session-context-client";
import { afterEach, describe, expect, it, vi } from "vitest";

function createPageEnvironment(href: string) {
	const url = new URL(href);
	const location = {
		href,
		hash: url.hash,
		pathname: url.pathname,
		search: url.search,
	};
	return {
		location,
		environment: createEnvironmentForNativeWeb({
			routerForNativeWebCreateOptions: { location },
			pageLifecycle: null,
			popup: null,
			persistentStorage: null,
			sessionStorage: null,
			transport: {
				execute: async () => ({ status: 204, headers: {}, body: null }),
			},
		}),
	};
}

describe("session-context browser minimal entry", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("shows the standalone browser entry path: loginWithRedirect navigates with explicit return URI", async () => {
		// 1. Create a session client with a router-backed browser environment.
		const { environment, location } = createPageEnvironment(
			"https://app.example.com/protected-page",
		);
		const client = SessionContextClient.fromEnvironmentConfig({
			config: { baseUrl: "https://auth.example.com" },
			environment,
		});

		await client.loginWithRedirect({
			postAuthRedirectUri: "https://app.example.com/dashboard",
		});

		expect(location.href).toBe(
			"https://auth.example.com/auth/session/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Fdashboard",
		);
	});

	it("shows the default-options path: no implicit post-auth redirect", async () => {
		const { environment, location } = createPageEnvironment(
			"https://app.example.com/current-page",
		);
		const client = SessionContextClient.fromEnvironmentConfig({
			config: { baseUrl: "https://auth.example.com" },
			environment,
		});

		await client.loginWithRedirect();

		expect(location.href).toBe("https://auth.example.com/auth/session/login");
	});
});
