import {
	createFoundationEnvironment,
	createSecuritydeptDestroyRef,
	SecuritydeptDestroyRef,
} from "@securitydept/client";
import { describe, expect, it, vi } from "vitest";
import {
	FRONTEND_OIDC_MODE_CLIENT,
	FRONTEND_OIDC_MODE_CLIENT_OPTIONS,
	FrontendOidcModeClient,
	provideFrontendOidcModeClient,
} from "../index";

describe("frontend OIDC mode providers", () => {
	it("constructs one environment-owned client from the core provider graph", () => {
		const options = {
			config: {
				issuer: "https://issuer.example.com",
				clientId: "webui",
				redirectUri: "https://app.example.com/auth/callback",
			},
		} as const;
		const environment = createFoundationEnvironment({
			providers: provideFrontendOidcModeClient(options),
		});

		expect(environment.injector.get(FRONTEND_OIDC_MODE_CLIENT_OPTIONS)).toBe(
			options,
		);
		const client = environment.injector.get(FRONTEND_OIDC_MODE_CLIENT);
		expect(client).toBeInstanceOf(FrontendOidcModeClient);
		expect(environment.injector.get(FRONTEND_OIDC_MODE_CLIENT)).toBe(client);
		expect(client.config.clientId).toBe("webui");
	});

	it("binds the client lifecycle to an injected destroy ref", () => {
		const destroyRef = createSecuritydeptDestroyRef();
		const environment = createFoundationEnvironment({
			providers: [
				{ provide: SecuritydeptDestroyRef, useValue: destroyRef },
				...provideFrontendOidcModeClient({
					config: {
						issuer: "https://issuer.example.com",
						clientId: "webui",
						redirectUri: "https://app.example.com/auth/callback",
					},
				}),
			],
		});
		const client = environment.injector.get(FRONTEND_OIDC_MODE_CLIENT);
		const dispose = vi.spyOn(client, "dispose");

		destroyRef.dispose();

		expect(dispose).toHaveBeenCalledOnce();
	});
});
