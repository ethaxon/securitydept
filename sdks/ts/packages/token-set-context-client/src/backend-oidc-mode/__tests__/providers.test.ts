import {
	createFoundationEnvironment,
	createSecuritydeptDestroyRef,
	SecuritydeptDestroyRef,
} from "@securitydept/client";
import { describe, expect, it, vi } from "vitest";
import {
	BACKEND_OIDC_MODE_CLIENT,
	BACKEND_OIDC_MODE_CLIENT_OPTIONS,
	BackendOidcModeClient,
	provideBackendOidcModeClient,
} from "../index";

describe("backend OIDC mode providers", () => {
	it("constructs one environment-owned client from the core provider graph", () => {
		const options = {
			config: {
				baseUrl: "https://auth.example.com",
			},
			callbackRoutingKey: "backend",
		} as const;
		const environment = createFoundationEnvironment({
			providers: provideBackendOidcModeClient(options),
		});

		expect(environment.injector.get(BACKEND_OIDC_MODE_CLIENT_OPTIONS)).toBe(
			options,
		);
		using client = environment.injector.get(BACKEND_OIDC_MODE_CLIENT);
		expect(client).toBeInstanceOf(BackendOidcModeClient);
		expect(environment.injector.get(BACKEND_OIDC_MODE_CLIENT)).toBe(client);
		expect(client.config.baseUrl).toBe("https://auth.example.com");
		expect(client.authorizeUrl()).toContain("callback_routing_key=backend");
	});

	it("binds the client lifecycle to an injected destroy ref", () => {
		const destroyRef = createSecuritydeptDestroyRef();
		const environment = createFoundationEnvironment({
			providers: [
				{ provide: SecuritydeptDestroyRef, useValue: destroyRef },
				...provideBackendOidcModeClient({
					config: { baseUrl: "https://auth.example.com" },
				}),
			],
		});
		const client = environment.injector.get(BACKEND_OIDC_MODE_CLIENT);
		const dispose = vi.spyOn(client, "dispose");

		// Destroy-ref propagation is the lifecycle action under test.
		destroyRef.dispose();

		expect(dispose).toHaveBeenCalledOnce();
	});
});
