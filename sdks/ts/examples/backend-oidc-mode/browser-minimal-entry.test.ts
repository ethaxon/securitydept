import {
	createInMemoryRecordStore,
	type RouterNavigationRequest,
	UriReferenceString,
} from "@securitydept/client";
import { createEnvironmentForNativeWeb } from "@securitydept/client/web";
import { BackendOidcModeClient } from "@securitydept/token-set-context-client/backend-oidc-mode";
import { describe, expect, it, vi } from "vitest";

describe("backend-oidc-mode browser minimal entry", () => {
	it("uses one native-web environment for startup and redirect navigation", async () => {
		let currentUrl = UriReferenceString.parse(
			"https://app.example.com/dashboard",
		);
		const navigate = vi.fn(async (request: RouterNavigationRequest) => {
			currentUrl = request.url;
		});
		const environment = createEnvironmentForNativeWeb({
			router: { currentUrl: () => currentUrl, navigate },
			pageLifecycle: null,
			popup: null,
			persistentStorage: createInMemoryRecordStore(),
			sessionStorage: createInMemoryRecordStore(),
		});
		const client = BackendOidcModeClient.fromEnvironmentConfig({
			config: { baseUrl: "https://auth.example.com" },
			environment,
			callbackInputResolver: null,
		});

		await expect(client.start()).resolves.toBeNull();
		await client.loginWithRedirect({
			postAuthRedirectUri: currentUrl.toString(),
		});

		expect(navigate).toHaveBeenCalledOnce();
		const authorizationUrl = new URL(currentUrl.toString());
		expect(authorizationUrl.origin).toBe("https://auth.example.com");
		expect(authorizationUrl.pathname).toBe("/auth/oidc/login");
		expect(authorizationUrl.searchParams.get("post_auth_redirect_uri")).toBe(
			"https://app.example.com/dashboard",
		);

		client.dispose();
	});
});
