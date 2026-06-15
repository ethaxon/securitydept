// Backend OIDC Mode — Canonical Subpath Contract Evidence

import {
	BackendOidcModeClient,
	type BackendOidcModeClientConfig,
	relayTokenSetPopupCallbackFromEnvironment,
} from "@securitydept/token-set-context-client/backend-oidc-mode";
import {
	provideTokenSetClientRegistry,
	TOKEN_SET_CLIENT_REGISTRY,
	TOKEN_SET_CLIENT_REGISTRY_ENTRIES,
	TokenSetClientRegistry,
} from "@securitydept/token-set-context-client/registry";
import {
	useTokenSetBackendCallback,
	useTokenSetClientRegistry,
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

describe("token-set core registry and React canonical entries", () => {
	it("owns registry composition in the framework-neutral registry entry", () => {
		expect(provideTokenSetClientRegistry).toBeDefined();
		expect(typeof provideTokenSetClientRegistry).toBe("function");
		expect(TokenSetClientRegistry).toBeDefined();
		expect(TOKEN_SET_CLIENT_REGISTRY).toBeDefined();
		expect(TOKEN_SET_CLIENT_REGISTRY_ENTRIES).toBeDefined();
	});

	it("exports only React-specific registry and callback hooks from the adapter", () => {
		expect(useTokenSetClientRegistry).toBeDefined();
		expect(typeof useTokenSetClientRegistry).toBe("function");
		expect(useTokenSetBackendCallback).toBeDefined();
		expect(typeof useTokenSetBackendCallback).toBe("function");
		expect(useTokenSetFrontendCallback).toBeDefined();
		expect(typeof useTokenSetFrontendCallback).toBe("function");
	});
});
