// Backend OIDC Mode — Canonical Subpath Contract Evidence
//
// This test proves that backend-OIDC adopters still get the expected public
// entry points after the React surface moved to the unified injector/runtime
// model.
//
// Section A: /backend-oidc-mode canonical entry
// Section B: /backend-oidc-mode/web canonical entry
// Section C: @securitydept/token-set-context-client-react canonical entry

import {
	AuthenticationSourceKind,
	BackendOidcModeClient,
	type BackendOidcModeClientConfig,
} from "@securitydept/token-set-context-client/backend-oidc-mode";
import {
	BackendOidcModeBootstrapSource,
	bootstrapBackendOidcModePageClient,
	createBackendOidcModeWebClientEnvironment,
} from "@securitydept/token-set-context-client/backend-oidc-mode/web";
import {
	provideTokenSetAuthRegistry,
	provideTokenSetCallbackResumeController,
	BackendOidcModeClient as ReactBackendOidcModeClient,
	TOKEN_SET_AUTH_REGISTRY,
	TOKEN_SET_CALLBACK_RESUME_CONTROLLER,
	TokenSetCallbackComponent,
	useTokenSetCallbackResume,
} from "@securitydept/token-set-context-client-react";
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
	it("exports page bootstrap and environment helpers from /backend-oidc-mode/web", () => {
		expect(bootstrapBackendOidcModePageClient).toBeDefined();
		expect(typeof bootstrapBackendOidcModePageClient).toBe("function");
		expect(createBackendOidcModeWebClientEnvironment).toBeDefined();
		expect(typeof createBackendOidcModeWebClientEnvironment).toBe("function");
	});

	it("exports BackendOidcModeBootstrapSource enum from /backend-oidc-mode/web", () => {
		expect(BackendOidcModeBootstrapSource).toBeDefined();
		expect(typeof BackendOidcModeBootstrapSource).toBe("object");
	});
});

// ---------------------------------------------------------------------------
// C. @securitydept/token-set-context-client-react canonical entry
// ---------------------------------------------------------------------------

describe("backend-oidc-mode/react canonical subpath", () => {
	it("exports backend-OIDC client types and composition helpers from the React root entry", () => {
		expect(ReactBackendOidcModeClient).toBeDefined();
		expect(typeof ReactBackendOidcModeClient).toBe("function");
		expect(provideTokenSetAuthRegistry).toBeDefined();
		expect(typeof provideTokenSetAuthRegistry).toBe("function");
		expect(provideTokenSetCallbackResumeController).toBeDefined();
		expect(typeof provideTokenSetCallbackResumeController).toBe("function");
		expect(useTokenSetCallbackResume).toBeDefined();
		expect(typeof useTokenSetCallbackResume).toBe("function");
	});

	it("exports injector tokens instead of a domain-specific React provider", () => {
		expect(TOKEN_SET_AUTH_REGISTRY).toBeDefined();
		expect(TOKEN_SET_CALLBACK_RESUME_CONTROLLER).toBeDefined();
		expect(TokenSetCallbackComponent).toBeDefined();
		expect(typeof TokenSetCallbackComponent).toBe("function");
	});
});
