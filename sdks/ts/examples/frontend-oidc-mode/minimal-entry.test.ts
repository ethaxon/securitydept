import {
	createFoundationEnvironment,
	createInMemoryRecordStore,
	type RouterNavigationRequest,
	UriReferenceString,
} from "@securitydept/client";
import {
	FRONTEND_OIDC_MODE_CLIENT,
	provideFrontendOidcModeClient,
} from "@securitydept/token-set-context-client/frontend-oidc-mode";
import { describe, expect, it, vi } from "vitest";

describe("frontend-oidc-mode minimal entry", () => {
	it("injects the client and starts redirect login through environment capabilities", async () => {
		let currentUrl = UriReferenceString.parse(
			"https://app.example.com/dashboard",
		);
		const navigate = vi.fn(async (request: RouterNavigationRequest) => {
			currentUrl = request.url;
		});
		const environment = createFoundationEnvironment({
			router: { currentUrl: () => currentUrl, navigate },
			sessionStorage: createInMemoryRecordStore(),
			providers: provideFrontendOidcModeClient({
				config: {
					issuer: "https://idp.example.com",
					clientId: "my-app",
					redirectUri: "https://app.example.com/callback",
					authorizationEndpoint: "https://idp.example.com/authorize",
					tokenEndpoint: "https://idp.example.com/token",
				},
				callbackInputResolver: null,
			}),
		});
		using client = environment.injector.get(FRONTEND_OIDC_MODE_CLIENT);

		await expect(client.start()).resolves.toBeNull();
		expect(client.authResource.value.get()).toBeNull();

		await client.loginWithRedirect({
			postAuthRedirectUri: "https://app.example.com/dashboard",
		});

		expect(navigate).toHaveBeenCalledOnce();
		const authorizationUrl = new URL(currentUrl.toString());
		expect(authorizationUrl.origin).toBe("https://idp.example.com");
		expect(authorizationUrl.pathname).toBe("/authorize");
		expect(authorizationUrl.searchParams.get("client_id")).toBe("my-app");
		expect(authorizationUrl.searchParams.get("state")).toBeTruthy();
		expect(authorizationUrl.searchParams.get("code_challenge")).toBeTruthy();
	});
});
