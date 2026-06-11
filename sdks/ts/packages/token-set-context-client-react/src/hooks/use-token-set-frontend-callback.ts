import {
	ClientError,
	ClientErrorKind,
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
} from "@securitydept/client-react";
import {
	type FrontendOidcModeCallbackResult,
	FrontendOidcModeClient,
} from "@securitydept/token-set-context-client/frontend-oidc-mode";
import {
	OidcModeCallbackHandlingKind,
	type OidcModeCallbackHandlingResult,
} from "@securitydept/token-set-context-client/orchestration";
import {
	selectTokenSetFrontendCallbackClientFromRegistry,
	TokenSetCallbackClientSelectionKind,
	type TokenSetClientQueryOptions,
	type TokenSetClientRegistry,
	TokenSetClientRegistryEntryStatus,
	type TokenSetFrontendCallbackClientFromRegistrySelection,
	TokenSetRegistryCallbackErrorCode,
	TokenSetRegistryCallbackErrorSource,
} from "@securitydept/token-set-context-client/registry";
import { useCallback, useEffect, useMemo } from "react";
import {
	TOKEN_SET_CLIENT_REGISTRY,
	type TokenSetClientRegistryService,
} from "../client-registry-service";

type FrontendCallbackResult =
	OidcModeCallbackHandlingResult<FrontendOidcModeCallbackResult>;

export interface UseTokenSetFrontendCallbackOptions {
	readonly registry?: TokenSetClientRegistry;
	readonly environment?: FoundationEnvironment;
	readonly clientQuery?: TokenSetClientQueryOptions;
	readonly autoInitialize?: boolean;
}

export interface UseTokenSetFrontendCallbackResult {
	readonly selection: TokenSetFrontendCallbackClientFromRegistrySelection;
	readonly state: ResourceSnapshot<FrontendCallbackResult>;
	readonly resource: ResourceTrait<FrontendCallbackResult>;
	initialize(): Promise<FrontendOidcModeClient | null>;
}

export function useTokenSetFrontendCallback(
	options: UseTokenSetFrontendCallbackOptions = {},
): UseTokenSetFrontendCallbackResult {
	const injector = useSecuritydeptContext();
	const registry =
		options.registry ??
		(injector.get(TOKEN_SET_CLIENT_REGISTRY) as TokenSetClientRegistryService);
	const environment = options.environment ?? injector.get(ENVIRONMENT_TOKEN);
	const callbackUrl = environment.router?.currentUrl()?.toString() ?? "";
	const selection = useMemo(
		() =>
			selectTokenSetFrontendCallbackClientFromRegistry({
				registry,
				callbackUrl,
				clientQuery: options.clientQuery,
			}),
		[callbackUrl, options.clientQuery, registry],
	);
	const resource = useMemo(
		() =>
			resourceFromSnapshots<FrontendCallbackResult>(() => {
				if (
					selection.kind === TokenSetCallbackClientSelectionKind.NotApplicable
				) {
					return {
						status: ResourceStatus.Resolved,
						value: { kind: OidcModeCallbackHandlingKind.NotApplicable },
					};
				}

				const record = selection.clientRecord.get();
				switch (record.status) {
					case TokenSetClientRegistryEntryStatus.Registered:
						return { status: ResourceStatus.Idle };
					case TokenSetClientRegistryEntryStatus.Initializing:
						return { status: ResourceStatus.Loading };
					case TokenSetClientRegistryEntryStatus.Failed:
						return {
							status: ResourceStatus.LoadingError,
							error: record.error,
						};
					case TokenSetClientRegistryEntryStatus.Ready:
						return record.client instanceof FrontendOidcModeClient
							? record.client.callback.state.get()
							: {
									status: ResourceStatus.LoadingError,
									error: new ClientError({
										kind: ClientErrorKind.Configuration,
										code: TokenSetRegistryCallbackErrorCode.ClientModeMismatch,
										message: `Client "${record.meta.clientKey}" is not a FrontendOidcModeClient.`,
										source: TokenSetRegistryCallbackErrorSource,
									}),
								};
				}
			}),
		[selection],
	);
	const state = useResourceSnapshot(resource);
	const initialize = useCallback(
		async () =>
			selection.kind === TokenSetCallbackClientSelectionKind.Selected
				? await selection.clientResolver()
				: null,
		[selection],
	);

	useEffect(() => {
		if (options.autoInitialize !== false) {
			void initialize().catch(() => undefined);
		}
	}, [initialize, options.autoInitialize]);
	useEffect(() => () => resource.dispose(), [resource]);

	return { selection, state, resource, initialize };
}
