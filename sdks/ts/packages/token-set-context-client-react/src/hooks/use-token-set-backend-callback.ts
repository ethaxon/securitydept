import {
	createComputed,
	createSignal,
	ENVIRONMENT_TOKEN,
	type FoundationEnvironment,
	type ResourceSnapshot,
	ResourceStatus,
	type ResourceTrait,
	resourceFromSnapshots,
} from "@securitydept/client";
import {
	useResourceSnapshot,
	useSecuritydeptContext,
	useSignal,
} from "@securitydept/client-react";
import { type BackendOidcModeClient } from "@securitydept/token-set-context-client/backend-oidc-mode";
import {
	OidcModeCallbackHandlingKind,
	type OidcModeCallbackHandlingResult,
	type TokenSetAuthSnapshot,
} from "@securitydept/token-set-context-client/orchestration";
import {
	selectTokenSetBackendCallbackClientFromRegistry,
	type TokenSetBackendCallbackClientFromRegistrySelectionSignal,
	type TokenSetCallbackClientQuery,
	TokenSetCallbackClientSelectionKind,
	type TokenSetCallbackClientSelectionSnapshot,
	type TokenSetClientRegistry,
} from "@securitydept/token-set-context-client/registry";
import { useEffect, useMemo, useState } from "react";
import {
	TOKEN_SET_CLIENT_REGISTRY,
	type TokenSetClientRegistryService,
} from "../client-registry-service";

type BackendCallbackResult =
	OidcModeCallbackHandlingResult<TokenSetAuthSnapshot>;

export interface UseTokenSetBackendCallbackOptions {
	readonly registry?: TokenSetClientRegistry;
	readonly environment?: FoundationEnvironment;
	readonly clientQuery?: TokenSetCallbackClientQuery;
	readonly autoInitialize?: boolean;
}

export interface UseTokenSetBackendCallbackResult {
	readonly selection: TokenSetCallbackClientSelectionSnapshot<BackendOidcModeClient>;
	readonly state: ResourceSnapshot<BackendCallbackResult>;
	readonly resource: ResourceTrait<BackendCallbackResult>;
}

export function useTokenSetBackendCallback(
	options: UseTokenSetBackendCallbackOptions = {},
): UseTokenSetBackendCallbackResult {
	const injector = useSecuritydeptContext();
	const registry =
		options.registry ??
		(injector.get(TOKEN_SET_CLIENT_REGISTRY) as TokenSetClientRegistryService);
	const environment = options.environment ?? injector.get(ENVIRONMENT_TOKEN);
	const [selectionSource] = useState(() =>
		createSignal<TokenSetBackendCallbackClientFromRegistrySelectionSignal | null>(
			null,
		),
	);
	const selectionSignal = useMemo(
		() =>
			createComputed<
				TokenSetCallbackClientSelectionSnapshot<BackendOidcModeClient>
			>(
				() =>
					selectionSource.get()?.get() ?? {
						status: ResourceStatus.Idle,
					},
			),
		[selectionSource],
	);
	const selection = useSignal(selectionSignal);
	const resource = useMemo(
		() =>
			resourceFromSnapshots<BackendCallbackResult>(() => {
				const current = selectionSource.get()?.get();
				if (!current) {
					return { status: ResourceStatus.Idle };
				}
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
		[selectionSource],
	);
	const state = useResourceSnapshot(resource);
	useEffect(() => {
		selectionSource.set(
			selectTokenSetBackendCallbackClientFromRegistry({
				registry,
				callbackUrl: environment.router?.currentUrl()?.toString() ?? "",
				clientQuery: options.clientQuery,
				initialize: options.autoInitialize !== false,
			}),
		);
		return () => selectionSource.set(null);
	}, [
		environment,
		options.autoInitialize,
		options.clientQuery,
		registry,
		selectionSource,
	]);
	useEffect(() => () => resource.dispose(), [resource]);

	return { selection, state, resource };
}
