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
	readonly setCurrentUrl: (url: string) => void;
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
		setCurrentUrl(url) {
			currentUrl = UriReferenceString.parse(url);
		},
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

	it("does not consume callback parameters when the condition rejects them", async () => {
		const { router, navigate } = createRouter(
			"https://app.example.com/callback?code=code-1&state=state-1",
		);
		const condition = vi.fn(async ({ callbackInput, callbackUrl }) => {
			expect(callbackUrl.pathname).toBe("/callback");
			expect(callbackInput).toEqual({
				searchParams: new URLSearchParams({
					code: "code-1",
					state: "state-1",
				}),
			});
			return false;
		});

		await expect(
			takeFrontendOidcCallbackInputFromRouter(router, { condition }),
		).resolves.toBeNull();
		expect(condition).toHaveBeenCalledOnce();
		expect(navigate).not.toHaveBeenCalled();
	});

	it("does not clean up a different URL that arrives while awaiting the condition", async () => {
		const { router, navigate, setCurrentUrl } = createRouter(
			"https://app.example.com/callback?code=code-1&state=state-1",
		);

		await expect(
			takeFrontendOidcCallbackInputFromRouter(router, {
				condition: async () => {
					setCurrentUrl(
						"https://app.example.com/callback?code=code-2&state=state-2",
					);
					return true;
				},
			}),
		).resolves.toBeNull();
		expect(navigate).not.toHaveBeenCalled();
		expect(router.currentUrl()?.searchParams.get("code")).toBe("code-2");
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
