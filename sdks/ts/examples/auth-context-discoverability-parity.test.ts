// @vitest-environment jsdom

// Auth-context discoverability parity evidence.
//
// Validates that basic-auth-context-client and session-context-client
// expose discoverable named contracts from their canonical subpaths,
// closing the discoverability gap identified in this iteration.

import {
	BasicAuthContextClient,
	type BasicAuthContextClientConfig,
	type BasicAuthLoginWithRedirectOptions as BasicAuthLoginOptions,
} from "@securitydept/basic-auth-context-client";
import {
	createFoundationEnvironment,
	createInMemoryRecordStore,
	createRootSpan,
	createTracing,
	type FoundationEnvironment,
} from "@securitydept/client";
import { createRouterForNativeWeb } from "@securitydept/client/web";
import {
	type SessionContextClientConfig,
	type SessionInfo,
	type SessionLoginWithRedirectOptions as SessionLoginOptions,
} from "@securitydept/session-context-client";
import { type CreateSessionContextClientOptions } from "@securitydept/session-context-client-react";
import { afterEach, describe, expect, it, vi } from "vitest";

function createPageLocationEnvironment(href: string): FoundationEnvironment & {
	location: { href: string; hash: string; pathname: string; search: string };
} {
	const url = new URL(href);
	const location = {
		href,
		hash: url.hash,
		pathname: url.pathname,
		search: url.search,
	};
	return Object.assign(
		createFoundationEnvironment({
			transport: {
				async execute() {
					throw new Error("Unexpected transport call.");
				},
			},
			router: createRouterForNativeWeb({ location }),
		}),
		{
			location,
		},
	);
}

// ---------------------------------------------------------------------------
// A. basic-auth-context-client: BasicAuthLoginWithRedirectOptions + loginWithRedirect
// ---------------------------------------------------------------------------

describe("basic-auth root discoverability: named options contract + client helper", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("BasicAuthLoginWithRedirectOptions is importable as a named type from root", () => {
		// Type-level evidence: the options contract is directly importable.
		const options: BasicAuthLoginOptions = {
			currentPath: "/basic/api/groups",
			postAuthRedirectUri: "https://app.example.com/basic/api/groups",
		};
		expect(options.currentPath).toBe("/basic/api/groups");
	});

	it("loginWithRedirect performs zone-resolved browser redirect", async () => {
		const environment = createPageLocationEnvironment(
			"https://app.example.com/basic/api/groups",
		);

		const client = new BasicAuthContextClient(
			{
				baseUrl: "https://auth.example.com",
				zones: [{ zonePrefix: "/basic" }],
			},
			environment,
		);

		await client.loginWithRedirect({
			currentPath: "/basic/api/groups",
			postAuthRedirectUri: environment.location.href,
		});

		expect(environment.location.href).toBe(
			"https://auth.example.com/basic/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Fbasic%2Fapi%2Fgroups",
		);
	});

	it("loginWithRedirect accepts explicit options for path and redirect", async () => {
		const environment = createPageLocationEnvironment(
			"https://app.example.com/other",
		);

		const client = new BasicAuthContextClient(
			{
				baseUrl: "https://auth.example.com",
				zones: [{ zonePrefix: "/basic" }],
			},
			environment,
		);

		const options: BasicAuthLoginOptions = {
			currentPath: "/basic/admin",
			postAuthRedirectUri: "https://app.example.com/basic/admin",
		};
		await client.loginWithRedirect(options);

		expect(environment.location.href).toBe(
			"https://auth.example.com/basic/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Fbasic%2Fadmin",
		);
	});

	it("loginWithRedirect rejects when path is outside all zones", async () => {
		const environment = createPageLocationEnvironment(
			"https://app.example.com/public",
		);

		const client = new BasicAuthContextClient(
			{
				baseUrl: "https://auth.example.com",
				zones: [{ zonePrefix: "/basic" }],
			},
			environment,
		);

		await expect(
			client.loginWithRedirect({
				currentPath: "/public",
			}),
		).rejects.toMatchObject({
			code: "basic_auth.zone_required",
		});
		expect(environment.location.href).toBe("https://app.example.com/public");
	});
});

// ---------------------------------------------------------------------------
// B. session-context-client/react: injector-first named contract discoverability
// ---------------------------------------------------------------------------

describe("session ./react discoverability: injector-first named contracts", () => {
	it("CreateSessionContextClientOptions is importable as a named type from ./react", () => {
		const options: CreateSessionContextClientOptions = {
			config: {
				baseUrl: "https://auth.example.com",
			},
			environment: createFoundationEnvironment({
				transport: {
					execute: async () => ({ status: 204, headers: {}, body: null }),
				},
				sessionStorage: createInMemoryRecordStore(),
				span: createRootSpan(),
				tracing: createTracing(),
			}),
		};

		expect(options.config.baseUrl).toBe("https://auth.example.com");
	});

	it("session root contracts still compose with SessionInfo shape", () => {
		const sessionInfo: SessionInfo = {
			principal: { subject: "session-user-1", displayName: "Alice" },
		};

		const options: CreateSessionContextClientOptions = {
			config: {
				baseUrl: "https://auth.example.com",
			},
			environment: createFoundationEnvironment({
				transport: {
					execute: async () => ({ status: 204, headers: {}, body: null }),
				},
				sessionStorage: createInMemoryRecordStore(),
				span: createRootSpan(),
				tracing: createTracing(),
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

	it("session root SessionLoginWithRedirectOptions is importable as named type", () => {
		const options: SessionLoginOptions = {
			postAuthRedirectUri: "https://app.example.com/dashboard",
		};
		expect(options.postAuthRedirectUri).toBeTruthy();
	});
});
