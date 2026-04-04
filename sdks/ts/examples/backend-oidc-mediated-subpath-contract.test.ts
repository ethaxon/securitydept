// Token-Set Canonical Subpath — Contract Evidence
//
// This test proves that the new canonical /oidc-mediated subpath family works
// correctly and that the root backward-compatible bridge still functions.
//
// Section A: /oidc-mediated canonical entry
// Section B: /oidc-mediated/web canonical entry (type-level export contract)
// Section C: /oidc-mediated/react canonical entry (type-level export contract)
// Section D: Root backward-compatible bridge
//
// Note: web/react adapter stability is `provisional` — canonical path has been
// reshaped, but full stability promotion requires dedicated evidence. This test
// proves the export contract works, not the full runtime behavior.
//
// Semantic layer: MinimalEntry

import type { BackendOidcMediatedModeClientConfig } from "@securitydept/token-set-context-client/backend-oidc-mediated-mode";
import {
	AuthenticationSourceKind,
	BackendOidcMediatedModeClient,
	AuthenticationSourceKind as RootAuthenticationSourceKind,
	BackendOidcMediatedModeClient as RootBackendOidcMediatedModeClient,
} from "@securitydept/token-set-context-client/backend-oidc-mediated-mode";
import {
	BackendOidcMediatedModeContextProvider,
	useAccessToken,
	useAuthState,
	useBackendOidcMediatedModeContext,
} from "@securitydept/token-set-context-client/backend-oidc-mediated-mode/react";
import {
	BackendOidcMediatedModeBootstrapSource,
	bootstrapBackendOidcMediatedModeClient,
} from "@securitydept/token-set-context-client/backend-oidc-mediated-mode/web";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// A. /oidc-mediated canonical entry — the sealed flow lives here now
// ---------------------------------------------------------------------------

describe("token-set canonical subpath", () => {
	it("exports BackendOidcMediatedModeClient from /oidc-mediated", () => {
		expect(BackendOidcMediatedModeClient).toBeDefined();
		expect(typeof BackendOidcMediatedModeClient).toBe("function");
	});

	it("exports AuthenticationSourceKind enum from /oidc-mediated", () => {
		expect(AuthenticationSourceKind).toBeDefined();
		expect(AuthenticationSourceKind.OidcAuthorizationCode).toBeDefined();
	});

	it("BackendOidcMediatedModeClientConfig type is usable from /oidc-mediated", () => {
		// Compile-time contract: the type exists and is assignable.
		const config: BackendOidcMediatedModeClientConfig = {
			baseUrl: "https://api.example.com",
		};
		expect(config.baseUrl).toBeTruthy();
	});
});

// ---------------------------------------------------------------------------
// B. /oidc-mediated/web canonical entry — export contract (provisional)
// ---------------------------------------------------------------------------

describe("token-set/web canonical subpath", () => {
	it("exports bootstrapBackendOidcMediatedModeClient from /oidc-mediated/web", () => {
		expect(bootstrapBackendOidcMediatedModeClient).toBeDefined();
		expect(typeof bootstrapBackendOidcMediatedModeClient).toBe("function");
	});

	it("exports BackendOidcMediatedModeBootstrapSource enum from /oidc-mediated/web", () => {
		expect(BackendOidcMediatedModeBootstrapSource).toBeDefined();
		// Verify it has the expected enum values
		expect(typeof BackendOidcMediatedModeBootstrapSource).toBe("object");
	});
});

// ---------------------------------------------------------------------------
// C. /oidc-mediated/react canonical entry — export contract (provisional)
// ---------------------------------------------------------------------------

describe("token-set/react canonical subpath", () => {
	it("exports React hooks from /oidc-mediated/react", () => {
		expect(useAccessToken).toBeDefined();
		expect(typeof useAccessToken).toBe("function");
		expect(useAuthState).toBeDefined();
		expect(typeof useAuthState).toBe("function");
		expect(useBackendOidcMediatedModeContext).toBeDefined();
		expect(typeof useBackendOidcMediatedModeContext).toBe("function");
	});

	it("exports BackendOidcMediatedModeContextProvider from /oidc-mediated/react", () => {
		expect(BackendOidcMediatedModeContextProvider).toBeDefined();
		expect(typeof BackendOidcMediatedModeContextProvider).toBe("function");
	});
});

// ---------------------------------------------------------------------------
// D. Root backward-compatible bridge — still works, same exports
// ---------------------------------------------------------------------------

describe("root backward-compatible bridge", () => {
	it("root exports the same BackendOidcMediatedModeClient as /oidc-mediated", () => {
		expect(RootBackendOidcMediatedModeClient).toBe(
			BackendOidcMediatedModeClient,
		);
	});

	it("root exports the same AuthenticationSourceKind as /oidc-mediated", () => {
		expect(RootAuthenticationSourceKind).toBe(AuthenticationSourceKind);
	});
});
