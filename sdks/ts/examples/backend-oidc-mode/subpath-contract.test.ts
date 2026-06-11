// Backend OIDC Mode — Canonical Subpath Contract Evidence

import {
	BackendOidcModeClient,
	type BackendOidcModeClientConfig,
	relayTokenSetPopupCallbackFromEnvironment,
} from "@securitydept/token-set-context-client/backend-oidc-mode";
import {
	provideTokenSetClientRegistry,
	BackendOidcModeClient as ReactBackendOidcModeClient,
	TOKEN_SET_CLIENT_REGISTRY,
	TOKEN_SET_CLIENT_REGISTRY_ENTRIES,
	TokenSetClientRegistryService,
	useTokenSetBackendCallback,
	useTokenSetFrontendCallback,
} from "@securitydept/token-set-context-client-react";
import { describe, expect, it } from "vitest";

describe("backend-oidc-mode canonical subpath", () => {
	it("exports BackendOidcModeClient from /backend-oidc-mode", () => {
		expect(BackendOidcModeClient).toBeDefined();
		expect(typeof BackendOidcModeClient).toBe("function");
	});

	it("BackendOidcModeClientConfig type is usable from /backend-oidc-mode", () => {
		const config: BackendOidcModeClientConfig = {
			baseUrl: "https://api.example.com",
		};
		expect(config.baseUrl).toBeTruthy();
	});
});

describe("backend-oidc-mode popup relay exports", () => {
	it("exports relayTokenSetPopupCallbackFromEnvironment from /backend-oidc-mode", () => {
		expect(relayTokenSetPopupCallbackFromEnvironment).toBeDefined();
		expect(typeof relayTokenSetPopupCallbackFromEnvironment).toBe("function");
	});
});

describe("token-set React canonical entry", () => {
	it("exports backend-OIDC client and registry composition helpers from the React root entry", () => {
		expect(ReactBackendOidcModeClient).toBeDefined();
		expect(typeof ReactBackendOidcModeClient).toBe("function");
		expect(provideTokenSetClientRegistry).toBeDefined();
		expect(typeof provideTokenSetClientRegistry).toBe("function");
		expect(TokenSetClientRegistryService).toBeDefined();
		expect(TOKEN_SET_CLIENT_REGISTRY).toBeDefined();
		expect(TOKEN_SET_CLIENT_REGISTRY_ENTRIES).toBeDefined();
	});

	it("exports headless callback resource hooks", () => {
		expect(useTokenSetBackendCallback).toBeDefined();
		expect(typeof useTokenSetBackendCallback).toBe("function");
		expect(useTokenSetFrontendCallback).toBeDefined();
		expect(typeof useTokenSetFrontendCallback).toBe("function");
	});
});
