import { createFoundationEnvironment } from "@securitydept/client";
import { BackendOidcModeClient } from "@securitydept/token-set-context-client/backend-oidc-mode";
import { describe, expect, it } from "vitest";

describe("backend-oidc-mode host-neutral minimal entry", () => {
	it("constructs and starts a standalone client from an explicit environment", async () => {
		const environment = createFoundationEnvironment({});
		const client = BackendOidcModeClient.fromEnvironmentConfig({
			config: { baseUrl: "https://auth.example.com" },
			environment,
			callbackInputResolver: null,
		});

		expect(client.authSnapshot.get()).toEqual({ status: "idle" });
		await expect(client.start()).resolves.toBeNull();
		expect(client.authResource.value.get()).toBeNull();
		expect(client.authorizeUrl("https://app.example.com/dashboard")).toContain(
			"post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Fdashboard",
		);

		client.dispose();
	});
});
