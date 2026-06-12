import {
	type CompatFragmentParameters,
	type HttpResponseJsonBody,
	parseCompatFragment,
	type RouterTrait,
	takeCompatFragmentFromRouter,
	type UriReferenceString,
} from "@securitydept/client";

export type BackendOidcModeCallbackInput =
	| CompatFragmentParameters
	| HttpResponseJsonBody;

export const BackendOidcModeCompatFragmentKind = {
	Callback: "token_set_backend_oidc_callback",
	Refresh: "token_set_backend_oidc_refresh",
} as const;

export type BackendOidcModeCompatFragmentKind =
	(typeof BackendOidcModeCompatFragmentKind)[keyof typeof BackendOidcModeCompatFragmentKind];

export interface BackendOidcModeCallbackInputConditionOptions {
	readonly callbackInput: BackendOidcModeCallbackInput;
	readonly callbackUrl: UriReferenceString;
	readonly callbackRoutingKey?: string;
}

export interface TakeBackendOidcCallbackInputFromRouterOptions {
	readonly condition?: (
		options: BackendOidcModeCallbackInputConditionOptions,
	) => boolean | Promise<boolean>;
}

export async function takeBackendOidcCallbackInputFromRouter(
	router: RouterTrait,
	options: TakeBackendOidcCallbackInputFromRouterOptions = {},
): Promise<BackendOidcModeCallbackInput | null> {
	const currentUrl = router.currentUrl();
	if (!currentUrl) {
		return null;
	}
	const currentCompatFragment = parseCompatFragment(currentUrl);
	if (
		!currentCompatFragment ||
		currentCompatFragment.parameters.kind !==
			BackendOidcModeCompatFragmentKind.Callback
	) {
		return null;
	}
	const {
		kind: _kind,
		callback_routing_key: _callbackRoutingKey,
		...previewCallbackInput
	} = currentCompatFragment.parameters;
	if (
		options.condition &&
		!(await options.condition({
			callbackInput: { ...previewCallbackInput },
			callbackUrl: currentUrl,
			callbackRoutingKey: currentCompatFragment.parameters.callback_routing_key,
		}))
	) {
		return null;
	}

	const compatFragment = await takeCompatFragmentFromRouter(router, {
		condition: ({ parameters, payload }) =>
			payload === currentCompatFragment.payload &&
			parameters.kind === BackendOidcModeCompatFragmentKind.Callback,
	});
	if (!compatFragment) {
		return null;
	}

	const {
		kind: _takenKind,
		callback_routing_key: _takenCallbackRoutingKey,
		...callbackInput
	} = compatFragment.parameters;
	return callbackInput;
}
