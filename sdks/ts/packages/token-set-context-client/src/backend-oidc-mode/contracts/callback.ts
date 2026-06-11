import {
	type CompatFragmentParameters,
	type HttpResponseJsonBody,
	type RouterTrait,
	takeCompatFragmentFromRouter,
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

export interface TakeBackendOidcCallbackInputFromRouterOptions {
	readonly callbackRoutingKey?: string;
}

export async function takeBackendOidcCallbackInputFromRouter(
	router: RouterTrait,
	options: TakeBackendOidcCallbackInputFromRouterOptions = {},
): Promise<BackendOidcModeCallbackInput | null> {
	const compatFragment = await takeCompatFragmentFromRouter(router, {
		condition: ({ parameters }) =>
			parameters.kind === BackendOidcModeCompatFragmentKind.Callback &&
			(options.callbackRoutingKey === undefined ||
				parameters.callback_routing_key === options.callbackRoutingKey),
	});
	if (!compatFragment) {
		return null;
	}

	const {
		kind: _kind,
		callback_routing_key: _callbackRoutingKey,
		...callbackInput
	} = compatFragment.parameters;
	return callbackInput;
}
