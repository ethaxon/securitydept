import {
	RouterNavigationIntent,
	RouterNavigationMode,
	type RouterTrait,
	type UriReferenceString,
} from "@securitydept/client";

export type FrontendOidcModeCallbackSearchString = "" | `?${string}`;

export type FrontendOidcModeCallbackInput =
	| string[][]
	| Record<string, string>
	| FrontendOidcModeCallbackSearchString
	| URLSearchParams
	| { searchParams: URLSearchParams };

export interface FrontendOidcModeCallbackInputConditionOptions {
	readonly callbackInput: FrontendOidcModeCallbackInput;
	readonly callbackUrl: UriReferenceString;
}

export interface TakeFrontendOidcCallbackInputFromRouterOptions {
	readonly condition?: (
		options: FrontendOidcModeCallbackInputConditionOptions,
	) => boolean | Promise<boolean>;
}

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
	options: TakeFrontendOidcCallbackInputFromRouterOptions = {},
): Promise<FrontendOidcModeCallbackInput | null> {
	const currentUrl = router.currentUrl();
	if (!currentUrl) {
		return null;
	}

	const callbackSearchParams = new URLSearchParams();
	for (const name of FRONTEND_OIDC_CALLBACK_PARAMETER_NAMES) {
		for (const value of currentUrl.searchParams.getAll(name)) {
			callbackSearchParams.append(name, value);
		}
	}
	const callbackInput = { searchParams: callbackSearchParams };
	if (
		options.condition &&
		!(await options.condition({
			callbackInput: {
				searchParams: new URLSearchParams(callbackSearchParams),
			},
			callbackUrl: currentUrl,
		}))
	) {
		return null;
	}
	if (router.currentUrl()?.toString() !== currentUrl.toString()) {
		return null;
	}

	const cleanedSearchParams = new URLSearchParams(currentUrl.searchParams);
	for (const name of FRONTEND_OIDC_CALLBACK_PARAMETER_NAMES) {
		cleanedSearchParams.delete(name);
	}

	if (callbackInput.searchParams.toString() !== "") {
		await router.navigate({
			url: currentUrl.setSearchParams(cleanedSearchParams),
			intent: RouterNavigationIntent.CallbackCleanup,
			mode: RouterNavigationMode.Replace,
		});
	}
	return callbackInput;
}
