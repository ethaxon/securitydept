// @vitest-environment jsdom

// Auth-context discoverability parity evidence — iteration 89
//
// Validates that basic-auth-context-client and session-context-client
// expose discoverable named contracts from their canonical subpaths,
// closing the discoverability gap identified in this iteration.

import {
	BasicAuthContextClient,
	type BasicAuthContextClientConfig,
} from "@securitydept/basic-auth-context-client";
import type { LoginWithRedirectOptions as BasicAuthLoginOptions } from "@securitydept/basic-auth-context-client/web";
import { loginWithRedirect as basicAuthLoginWithRedirect } from "@securitydept/basic-auth-context-client/web";
import type {
	SessionContextClientConfig,
	SessionInfo,
} from "@securitydept/session-context-client";
import type { LoginWithRedirectOptions as SessionLoginOptions } from "@securitydept/session-context-client/web";
import type { SessionContextValue } from "@securitydept/session-context-client-react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// A. basic-auth-context-client/web: LoginWithRedirectOptions + loginWithRedirect
// ---------------------------------------------------------------------------

describe("basic-auth ./web discoverability: named options contract + convenience helper", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("LoginWithRedirectOptions is importable as a named type from ./web", () => {
		// Type-level evidence: the options contract is directly importable.
		const options: BasicAuthLoginOptions = {
			currentPath: "/basic/api/groups",
			postAuthRedirectUri: "https://app.example.com/basic/api/groups",
		};
		expect(options.currentPath).toBe("/basic/api/groups");
	});

	it("loginWithRedirect performs zone-resolved browser redirect", () => {
		vi.stubGlobal("location", {
			pathname: "/basic/api/groups",
			href: "https://app.example.com/basic/api/groups",
		});

		const client = new BasicAuthContextClient({
			baseUrl: "https://auth.example.com",
			zones: [{ zonePrefix: "/basic" }],
		});

		const result = basicAuthLoginWithRedirect(client);

		expect(result).toBe(true);
		expect(globalThis.location.href).toBe(
			"https://auth.example.com/basic/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Fbasic%2Fapi%2Fgroups",
		);
	});

	it("loginWithRedirect accepts explicit options for path and redirect", () => {
		vi.stubGlobal("location", {
			pathname: "/other",
			href: "https://app.example.com/other",
		});

		const client = new BasicAuthContextClient({
			baseUrl: "https://auth.example.com",
			zones: [{ zonePrefix: "/basic" }],
		});

		const options: BasicAuthLoginOptions = {
			currentPath: "/basic/admin",
			postAuthRedirectUri: "https://app.example.com/basic/admin",
		};
		const result = basicAuthLoginWithRedirect(client, options);

		expect(result).toBe(true);
		expect(globalThis.location.href).toBe(
			"https://auth.example.com/basic/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Fbasic%2Fadmin",
		);
	});

	it("loginWithRedirect returns false when path is outside all zones", () => {
		vi.stubGlobal("location", {
			pathname: "/public",
			href: "https://app.example.com/public",
		});

		const client = new BasicAuthContextClient({
			baseUrl: "https://auth.example.com",
			zones: [{ zonePrefix: "/basic" }],
		});

		const result = basicAuthLoginWithRedirect(client, {
			currentPath: "/public",
		});

		expect(result).toBe(false);
		// location should not have been changed
		expect(globalThis.location.href).toBe("https://app.example.com/public");
	});
});

// ---------------------------------------------------------------------------
// B. session-context-client/react: SessionContextValue is now exported
// ---------------------------------------------------------------------------

describe("session ./react discoverability: SessionContextValue named contract", () => {
	it("SessionContextValue is importable as a named type from ./react", () => {
		// Type-level evidence: the context value contract is directly importable.
		// This allows adopters to type custom hooks that depend on the session context.
		type AssertValue = SessionContextValue;

		// Build a mock value that satisfies the contract to prove type-level access.
		const mockValue: AssertValue = {
			client: {} as AssertValue["client"],
			session: null,
			loading: true,
			refresh: () => {},
			rememberPostAuthRedirect: async () => {},
			clearPostAuthRedirect: async () => {},
			resolveLoginUrl: async () => "/auth/session/login",
			logout: async () => {},
		};

		expect(mockValue.loading).toBe(true);
		expect(mockValue.session).toBeNull();
	});

	it("SessionContextValue has expected shape with session info", () => {
		const sessionInfo: SessionInfo = {
			principal: { subject: "session-user-1", displayName: "Alice" },
		};

		const value: SessionContextValue = {
			client: {} as SessionContextValue["client"],
			session: sessionInfo,
			loading: false,
			refresh: () => {},
			rememberPostAuthRedirect: async () => {},
			clearPostAuthRedirect: async () => {},
			resolveLoginUrl: async () => "/auth/session/login",
			logout: async () => {},
		};

		expect(value.session?.principal.displayName).toBe("Alice");
		expect(value.loading).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// C. Cross-line type-level parity: both clients' configs are named + importable
// ---------------------------------------------------------------------------

describe("cross-line config contract discoverability parity", () => {
	it("BasicAuthContextClientConfig is directly importable from root", () => {
		const config: BasicAuthContextClientConfig = {
			baseUrl: "https://auth.example.com",
			zones: [{ zonePrefix: "/basic" }],
		};
		expect(config.baseUrl).toBeTruthy();
	});

	it("SessionContextClientConfig is directly importable from root", () => {
		const config: SessionContextClientConfig = {
			baseUrl: "https://auth.example.com",
		};
		expect(config.baseUrl).toBeTruthy();
	});

	it("session ./web LoginWithRedirectOptions is importable as named type", () => {
		const options: SessionLoginOptions = {
			postAuthRedirectUri: "https://app.example.com/dashboard",
		};
		expect(options.postAuthRedirectUri).toBeTruthy();
	});
});
