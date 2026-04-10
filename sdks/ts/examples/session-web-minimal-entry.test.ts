// @vitest-environment jsdom

// Session-context web minimal entry — standalone adopter-facing evidence
//
// This test proves the standalone browser entry path for session-context
// login redirect, exercising the canonical import surface from
// @securitydept/session-context-client/web.
//
// It is intentionally self-contained: no shared helpers from multi-line
// convenience baselines. An adopter reading this file should understand
// "how do I start a session login from the browser?" in one glance.

import { createInMemoryRecordStore } from "@securitydept/client";
import { SessionContextClient } from "@securitydept/session-context-client";
import type { LoginWithRedirectOptions } from "@securitydept/session-context-client/web";
import { loginWithRedirect } from "@securitydept/session-context-client/web";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("session-context web minimal entry", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("shows the standalone browser entry path: loginWithRedirect saves intent and navigates", async () => {
		// 1. Create a session client with an in-memory store for pending redirect.
		const sessionStore = createInMemoryRecordStore();
		const client = new SessionContextClient(
			{ baseUrl: "https://auth.example.com" },
			{ sessionStore },
		);

		// 2. Stub the browser's window.location.
		vi.stubGlobal("window", {
			location: { href: "https://app.example.com/protected-page" },
		});

		// 3. Trigger login redirect with explicit options.
		const options: LoginWithRedirectOptions = {
			postAuthRedirectUri: "https://app.example.com/dashboard",
		};
		await loginWithRedirect(client, options);

		// 4. Verify the browser navigated to the login URL.
		expect(window.location.href).toBe(
			"https://auth.example.com/auth/session/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Fdashboard",
		);

		// 5. Verify the pending redirect intent was persisted.
		expect(await client.loadPendingLoginRedirect()).toBe(
			"https://app.example.com/dashboard",
		);
	});

	it("shows the default-options path: uses window.location.href when postAuthRedirectUri is omitted", async () => {
		const sessionStore = createInMemoryRecordStore();
		const client = new SessionContextClient(
			{ baseUrl: "https://auth.example.com" },
			{ sessionStore },
		);

		vi.stubGlobal("window", {
			location: { href: "https://app.example.com/current-page" },
		});

		// Omit options — loginWithRedirect defaults to window.location.href.
		await loginWithRedirect(client);

		expect(window.location.href).toBe(
			"https://auth.example.com/auth/session/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Fcurrent-page",
		);

		expect(await client.loadPendingLoginRedirect()).toBe(
			"https://app.example.com/current-page",
		);
	});

	it("LoginWithRedirectOptions is importable as a named type from ./web", () => {
		// Type-level evidence: the options contract is directly importable
		// from the canonical ./web subpath, not hidden behind a multi-line
		// convenience barrel.
		const options: LoginWithRedirectOptions = {
			postAuthRedirectUri: "https://app.example.com/after-login",
		};
		expect(options.postAuthRedirectUri).toBeTruthy();
	});
});
