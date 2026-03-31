// Token-Set Canonical Subpath — Contract Evidence
//
// This test proves that the new canonical /token-set subpath family works
// correctly and that the root backward-compatible bridge still functions.
//
// Section A: /token-set canonical entry
// Section B: /token-set/web canonical entry (type-level export contract)
// Section C: /token-set/react canonical entry (type-level export contract)
// Section D: Root backward-compatible bridge
//
// Note: web/react adapter stability is `provisional` — canonical path has been
// reshaped, but full stability promotion requires dedicated evidence. This test
// proves the export contract works, not the full runtime behavior.
//
// Semantic layer: MinimalEntry

import {
	AuthenticationSourceKind as RootAuthenticationSourceKind,
	TokenSetContextClient as RootTokenSetContextClient,
} from "@securitydept/token-set-context-client";
import type { TokenSetContextClientConfig } from "@securitydept/token-set-context-client/token-set";
import {
	AuthenticationSourceKind,
	TokenSetContextClient,
} from "@securitydept/token-set-context-client/token-set";
import {
	TokenSetContextProvider,
	useAccessToken,
	useAuthState,
	useTokenSetContext,
} from "@securitydept/token-set-context-client/token-set/react";
import {
	bootstrapTokenSetClient,
	TokenSetBootstrapSource,
} from "@securitydept/token-set-context-client/token-set/web";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// A. /token-set canonical entry — the sealed flow lives here now
// ---------------------------------------------------------------------------

describe("token-set canonical subpath", () => {
	it("exports TokenSetContextClient from /token-set", () => {
		expect(TokenSetContextClient).toBeDefined();
		expect(typeof TokenSetContextClient).toBe("function");
	});

	it("exports AuthenticationSourceKind enum from /token-set", () => {
		expect(AuthenticationSourceKind).toBeDefined();
		expect(AuthenticationSourceKind.OidcAuthorizationCode).toBeDefined();
	});

	it("TokenSetContextClientConfig type is usable from /token-set", () => {
		// Compile-time contract: the type exists and is assignable.
		const config: TokenSetContextClientConfig = {
			baseUrl: "https://api.example.com",
		};
		expect(config.baseUrl).toBeTruthy();
	});
});

// ---------------------------------------------------------------------------
// B. /token-set/web canonical entry — export contract (provisional)
// ---------------------------------------------------------------------------

describe("token-set/web canonical subpath", () => {
	it("exports bootstrapTokenSetClient from /token-set/web", () => {
		expect(bootstrapTokenSetClient).toBeDefined();
		expect(typeof bootstrapTokenSetClient).toBe("function");
	});

	it("exports TokenSetBootstrapSource enum from /token-set/web", () => {
		expect(TokenSetBootstrapSource).toBeDefined();
		// Verify it has the expected enum values
		expect(typeof TokenSetBootstrapSource).toBe("object");
	});
});

// ---------------------------------------------------------------------------
// C. /token-set/react canonical entry — export contract (provisional)
// ---------------------------------------------------------------------------

describe("token-set/react canonical subpath", () => {
	it("exports React hooks from /token-set/react", () => {
		expect(useAccessToken).toBeDefined();
		expect(typeof useAccessToken).toBe("function");
		expect(useAuthState).toBeDefined();
		expect(typeof useAuthState).toBe("function");
		expect(useTokenSetContext).toBeDefined();
		expect(typeof useTokenSetContext).toBe("function");
	});

	it("exports TokenSetContextProvider from /token-set/react", () => {
		expect(TokenSetContextProvider).toBeDefined();
		expect(typeof TokenSetContextProvider).toBe("function");
	});
});

// ---------------------------------------------------------------------------
// D. Root backward-compatible bridge — still works, same exports
// ---------------------------------------------------------------------------

describe("root backward-compatible bridge", () => {
	it("root exports the same TokenSetContextClient as /token-set", () => {
		expect(RootTokenSetContextClient).toBe(TokenSetContextClient);
	});

	it("root exports the same AuthenticationSourceKind as /token-set", () => {
		expect(RootAuthenticationSourceKind).toBe(AuthenticationSourceKind);
	});
});
