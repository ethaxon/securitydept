// Backend OIDC Mode — Canonical Subpath Contract Evidence
//
// This test proves that the canonical /backend-oidc-mode subpath family works
// correctly with all three entry points (root, web, react).
//
// Section A: /backend-oidc-mode canonical entry
// Section B: /backend-oidc-mode/web canonical entry
// Section C: /backend-oidc-mode/react canonical entry

import type { BackendOidcModeClientConfig } from "@securitydept/token-set-context-client/backend-oidc-mode";
import {
	AuthenticationSourceKind,
	BackendOidcModeClient,
} from "@securitydept/token-set-context-client/backend-oidc-mode";
import {
	BackendOidcModeContextProvider,
	useAccessToken,
	useAuthState,
	useBackendOidcModeContext,
} from "@securitydept/token-set-context-client/backend-oidc-mode/react";
import {
	BackendOidcModeBootstrapSource,
	bootstrapBackendOidcModeClient,
} from "@securitydept/token-set-context-client/backend-oidc-mode/web";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// A. /backend-oidc-mode canonical entry
// ---------------------------------------------------------------------------

describe("backend-oidc-mode canonical subpath", () => {
	it("exports BackendOidcModeClient from /backend-oidc-mode", () => {
		expect(BackendOidcModeClient).toBeDefined();
		expect(typeof BackendOidcModeClient).toBe("function");
	});

	it("exports AuthenticationSourceKind enum from /backend-oidc-mode", () => {
		expect(AuthenticationSourceKind).toBeDefined();
		expect(AuthenticationSourceKind.OidcAuthorizationCode).toBeDefined();
	});

	it("BackendOidcModeClientConfig type is usable from /backend-oidc-mode", () => {
		const config: BackendOidcModeClientConfig = {
			baseUrl: "https://api.example.com",
		};
		expect(config.baseUrl).toBeTruthy();
	});
});

// ---------------------------------------------------------------------------
// B. /backend-oidc-mode/web canonical entry
// ---------------------------------------------------------------------------

describe("backend-oidc-mode/web canonical subpath", () => {
	it("exports bootstrapBackendOidcModeClient from /backend-oidc-mode/web", () => {
		expect(bootstrapBackendOidcModeClient).toBeDefined();
		expect(typeof bootstrapBackendOidcModeClient).toBe("function");
	});

	it("exports BackendOidcModeBootstrapSource enum from /backend-oidc-mode/web", () => {
		expect(BackendOidcModeBootstrapSource).toBeDefined();
		expect(typeof BackendOidcModeBootstrapSource).toBe("object");
	});
});

// ---------------------------------------------------------------------------
// C. /backend-oidc-mode/react canonical entry
// ---------------------------------------------------------------------------

describe("backend-oidc-mode/react canonical subpath", () => {
	it("exports React hooks from /backend-oidc-mode/react", () => {
		expect(useAccessToken).toBeDefined();
		expect(typeof useAccessToken).toBe("function");
		expect(useAuthState).toBeDefined();
		expect(typeof useAuthState).toBe("function");
		expect(useBackendOidcModeContext).toBeDefined();
		expect(typeof useBackendOidcModeContext).toBe("function");
	});

	it("exports BackendOidcModeContextProvider from /backend-oidc-mode/react", () => {
		expect(BackendOidcModeContextProvider).toBeDefined();
		expect(typeof BackendOidcModeContextProvider).toBe("function");
	});
});
