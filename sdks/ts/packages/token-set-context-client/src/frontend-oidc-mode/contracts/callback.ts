import {
	RouterNavigationIntent,
	RouterNavigationMode,
	type RouterTrait,
} from "@securitydept/client";

export type FrontendOidcModeCallbackSearchString = "" | `?${string}`;

export type FrontendOidcModeCallbackInput =
	| string[][]
	| Record<string, string>
	| FrontendOidcModeCallbackSearchString
	| URLSearchParams
	| { searchParams: URLSearchParams };

const FRONTEND_OIDC_CALLBACK_PARAMETER_NAMES = [
	"code",
	"state",
	"iss",
	"session_state",
	"error",
	"error_description",
	"error_uri",
] as const;

export async function takeFrontendOidcCallbackInputFromRouter(
	router: RouterTrait,
): Promise<FrontendOidcModeCallbackInput | null> {
	const currentUrl = router.currentUrl();
	if (!currentUrl) {
		return null;
	}

	const currentSearchParams = currentUrl.searchParams;
	const callbackSearchParams = new URLSearchParams();
	const cleanedSearchParams = new URLSearchParams(currentSearchParams);
	let hasCallbackParameters = false;
	for (const name of FRONTEND_OIDC_CALLBACK_PARAMETER_NAMES) {
		for (const value of currentSearchParams.getAll(name)) {
			hasCallbackParameters = true;
			callbackSearchParams.append(name, value);
		}
		cleanedSearchParams.delete(name);
	}

	if (hasCallbackParameters) {
		await router.navigate({
			url: currentUrl.setSearchParams(cleanedSearchParams),
			intent: RouterNavigationIntent.CallbackCleanup,
			mode: RouterNavigationMode.Replace,
		});
	}
	return { searchParams: callbackSearchParams };
}
