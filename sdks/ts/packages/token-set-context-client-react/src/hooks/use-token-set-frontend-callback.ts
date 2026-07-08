import {
	createComputed,
	createSignal,
	ENVIRONMENT_TOKEN,
	type FoundationEnvironment,
	type ResourceSnapshot,
	ResourceStatus,
	SYMBOL_OBSERVABLE,
} from "@securitydept/client";
import {
	useInitialRef,
	useResourceSnapshot,
	useSecuritydeptContext,
	useSignal,
} from "@securitydept/client-react";
import { type FrontendOidcModeCallbackResult } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import {
	OidcModeCallbackHandlingKind,
	type OidcModeCallbackHandlingResult,
} from "@securitydept/token-set-context-client/orchestration";
import {
	selectTokenSetFrontendCallbackClientFromRegistry,
	TOKEN_SET_CLIENT_REGISTRY,
	type TokenSetCallbackClientGuard,
	type TokenSetCallbackClientQuery,
	TokenSetCallbackClientSelectionKind,
	type TokenSetCallbackClientSelectionSnapshot,
	type TokenSetClientRegistry,
	type TokenSetFrontendCallbackClient,
} from "@securitydept/token-set-context-client/registry";
import { useEffect, useMemo } from "react";

type FrontendCallbackResult =
	OidcModeCallbackHandlingResult<FrontendOidcModeCallbackResult>;

export interface UseTokenSetFrontendCallbackOptions {
	readonly registry?: TokenSetClientRegistry;
	readonly environment?: FoundationEnvironment;
	readonly clientQuery?: TokenSetCallbackClientQuery;
	readonly clientGuard?: TokenSetCallbackClientGuard<TokenSetFrontendCallbackClient>;
	readonly autoInitialize?: boolean;
}

export interface UseTokenSetFrontendCallbackResult {
	readonly selection: TokenSetCallbackClientSelectionSnapshot<TokenSetFrontendCallbackClient>;
	readonly state: ResourceSnapshot<FrontendCallbackResult>;
}

export function useTokenSetFrontendCallback(
	options: UseTokenSetFrontendCallbackOptions = {},
): UseTokenSetFrontendCallbackResult {
	const injector = useSecuritydeptContext();
	const registry = options.registry ?? injector.get(TOKEN_SET_CLIENT_REGISTRY);
	const environment = options.environment ?? injector.get(ENVIRONMENT_TOKEN);
	const selectionSignal = useInitialRef(() =>
		createSignal<
			TokenSetCallbackClientSelectionSnapshot<TokenSetFrontendCallbackClient>
		>({
			status: ResourceStatus.Idle,
		}),
	).current;
	const selection = useSignal(selectionSignal);
	const stateSignal = useMemo(
		() =>
			createComputed<ResourceSnapshot<FrontendCallbackResult>>(() => {
				const current = selectionSignal.get();
				switch (current.status) {
					case ResourceStatus.Idle:
						return { status: ResourceStatus.Idle };
					case ResourceStatus.Loading:
						return { status: ResourceStatus.Loading };
					case ResourceStatus.LoadingError:
						return current;
					case ResourceStatus.Resolved:
						return current.value.kind ===
							TokenSetCallbackClientSelectionKind.NotApplicable
							? {
									status: ResourceStatus.Resolved,
									value: {
										kind: OidcModeCallbackHandlingKind.NotApplicable,
									},
								}
							: current.value.client.callback.state.get();
				}
			}),
		[selectionSignal],
	);
	const state = useResourceSnapshot(stateSignal);
	useEffect(() => {
		const source = selectTokenSetFrontendCallbackClientFromRegistry({
			registry,
			callbackUrl: environment.router?.currentUrl()?.toString() ?? "",
			clientQuery: options.clientQuery,
			clientGuard: options.clientGuard,
			initialize: options.autoInitialize !== false,
		});
		const subscription = source[SYMBOL_OBSERVABLE]().subscribe({
			next: (snapshot) => selectionSignal.set(snapshot),
		});
		return () => {
			subscription.unsubscribe();
			selectionSignal.set({ status: ResourceStatus.Idle });
		};
	}, [
		environment,
		options.autoInitialize,
		options.clientGuard,
		options.clientQuery,
		registry,
		selectionSignal,
	]);

	return { selection, state };
}
