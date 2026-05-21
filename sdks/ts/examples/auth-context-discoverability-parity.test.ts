// @vitest-environment jsdom

// Auth-context discoverability parity evidence.
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
import type { PageLocationCapability } from "@securitydept/client";
import { createInMemoryRecordStore } from "@securitydept/client";
import { createWebClientEnvironment } from "@securitydept/client/web";
import type {
	SessionContextClientConfig,
	SessionInfo,
} from "@securitydept/session-context-client";
import type { LoginWithRedirectOptions as SessionLoginOptions } from "@securitydept/session-context-client/web";
import type { CreateSessionContextControllerOptions } from "@securitydept/session-context-client-react";
import { afterEach, describe, expect, it, vi } from "vitest";

function createPageLocationEnvironment(href: string): PageLocationCapability {
	const url = new URL(href);
	return {
		location: {
			href,
			hash: url.hash,
			pathname: url.pathname,
			search: url.search,
		},
	};
}

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
		const environment = createPageLocationEnvironment(
			"https://app.example.com/basic/api/groups",
		);

		const client = new BasicAuthContextClient({
			baseUrl: "https://auth.example.com",
			zones: [{ zonePrefix: "/basic" }],
		});

		const result = basicAuthLoginWithRedirect(client, { environment });

		expect(result).toBe(true);
		expect(environment.location.href).toBe(
			"https://auth.example.com/basic/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Fbasic%2Fapi%2Fgroups",
		);
	});

	it("loginWithRedirect accepts explicit options for path and redirect", () => {
		const environment = createPageLocationEnvironment(
			"https://app.example.com/other",
		);

		const client = new BasicAuthContextClient({
			baseUrl: "https://auth.example.com",
			zones: [{ zonePrefix: "/basic" }],
		});

		const options: BasicAuthLoginOptions = {
			environment,
			currentPath: "/basic/admin",
			postAuthRedirectUri: "https://app.example.com/basic/admin",
		};
		const result = basicAuthLoginWithRedirect(client, options);

		expect(result).toBe(true);
		expect(environment.location.href).toBe(
			"https://auth.example.com/basic/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Fbasic%2Fadmin",
		);
	});

	it("loginWithRedirect returns false when path is outside all zones", () => {
		const environment = createPageLocationEnvironment(
			"https://app.example.com/public",
		);

		const client = new BasicAuthContextClient({
			baseUrl: "https://auth.example.com",
			zones: [{ zonePrefix: "/basic" }],
		});

		const result = basicAuthLoginWithRedirect(client, {
			environment,
			currentPath: "/public",
		});

		expect(result).toBe(false);
		expect(environment.location.href).toBe("https://app.example.com/public");
	});
});

// ---------------------------------------------------------------------------
// B. session-context-client/react: injector-first named contract discoverability
// ---------------------------------------------------------------------------

describe("session ./react discoverability: injector-first named contracts", () => {
	it("CreateSessionContextControllerOptions is importable as a named type from ./react", () => {
		const options: CreateSessionContextControllerOptions = {
			config: {
				baseUrl: "https://auth.example.com",
			},
			environment: createWebClientEnvironment({
				transport:
					{} as CreateSessionContextControllerOptions["environment"]["transport"],
				sessionStore: createInMemoryRecordStore(),
			}),
		};

		expect(options.config.baseUrl).toBe("https://auth.example.com");
	});

	it("session root contracts still compose with SessionInfo shape", () => {
		const sessionInfo: SessionInfo = {
			principal: { subject: "session-user-1", displayName: "Alice" },
		};

		const options: CreateSessionContextControllerOptions = {
			config: {
				baseUrl: "https://auth.example.com",
			},
			environment: createWebClientEnvironment({
				transport:
					{} as CreateSessionContextControllerOptions["environment"]["transport"],
				sessionStore: createInMemoryRecordStore(),
			}),
		};

		expect(sessionInfo.principal.displayName).toBe("Alice");
		expect(options.config.baseUrl).toBeTruthy();
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
