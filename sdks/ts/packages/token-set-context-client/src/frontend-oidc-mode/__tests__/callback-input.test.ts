import {
	RouterNavigationIntent,
	RouterNavigationMode,
	type RouterNavigationRequest,
	type RouterTrait,
	UriReferenceString,
} from "@securitydept/client";
import { describe, expect, it, vi } from "vitest";
import { takeFrontendOidcCallbackInputFromRouter } from "../contracts/callback";

function createRouter(url: string): {
	readonly router: RouterTrait;
	readonly navigate: ReturnType<typeof vi.fn>;
} {
	let currentUrl = UriReferenceString.parse(url);
	const navigate = vi.fn(async (request: RouterNavigationRequest) => {
		currentUrl = request.url;
	});
	return {
		router: {
			currentUrl: () => currentUrl,
			navigate,
		},
		navigate,
	};
}

describe("frontend OIDC callback input", () => {
	it("takes callback parameters and preserves application query and hash", async () => {
		const { router, navigate } = createRouter(
			"https://app.example.com/callback?tab=security&code=code-1&state=state-1&session_state=session-1#/settings",
		);

		const callbackInput = await takeFrontendOidcCallbackInputFromRouter(router);

		expect(callbackInput).toEqual({
			searchParams: new URLSearchParams({
				code: "code-1",
				state: "state-1",
				session_state: "session-1",
			}),
		});
		expect(navigate).toHaveBeenCalledWith({
			url: UriReferenceString.parse(
				"https://app.example.com/callback?tab=security#/settings",
			),
			intent: RouterNavigationIntent.CallbackCleanup,
			mode: RouterNavigationMode.Replace,
		});
	});

	it("takes error callback parameters", async () => {
		const { router } = createRouter(
			"https://app.example.com/callback?error=access_denied&error_description=Denied&state=state-1",
		);

		const callbackInput = await takeFrontendOidcCallbackInputFromRouter(router);

		expect(callbackInput).toEqual({
			searchParams: new URLSearchParams({
				state: "state-1",
				error: "access_denied",
				error_description: "Denied",
			}),
		});
	});

	it("returns an empty callback input without navigating when the route has no sensitive parameters", async () => {
		const { router, navigate } = createRouter(
			"https://app.example.com/callback?tab=security#/settings",
		);

		await expect(
			takeFrontendOidcCallbackInputFromRouter(router),
		).resolves.toEqual({ searchParams: new URLSearchParams() });
		expect(navigate).not.toHaveBeenCalled();
	});

	it("returns null only when the router has no current URL", async () => {
		const router: RouterTrait = {
			currentUrl: () => null,
			navigate: vi.fn(),
		};

		await expect(
			takeFrontendOidcCallbackInputFromRouter(router),
		).resolves.toBeNull();
	});
});
