import {
	ClientError,
	ClientErrorKind,
	createComputed,
	parseCompatFragment,
	type ReadableSignalTrait,
	type ResourceLoadingErrorSnapshot,
	type ResourceSnapshot,
	ResourceStatus,
	UriReferenceString,
	type UriReferenceStringInput,
	UserRecovery,
} from "@securitydept/client";
import {
	BackendOidcModeClient,
	BackendOidcModeCompatFragmentKind,
} from "../backend-oidc-mode";
import { FrontendOidcModeClient } from "../frontend-oidc-mode/client/client";
import { type BaseOidcModeClient } from "../orchestration/client/base-client";
import { type TokenSetClientQueryOptions } from "./contracts/query";
import { type TokenSetClientRecordView } from "./contracts/types";
import { type TokenSetClientRegistry } from "./core/client-registry";

export const TokenSetRegistryCallbackErrorCode = {
	ClientNotFound: "token_set.registry.callback.client_not_found",
	ClientModeMismatch: "token_set.registry.callback.client_mode_mismatch",
	RoutingKeyMissing: "token_set.registry.callback.routing_key_missing",
	ClientSelectionAmbiguous:
		"token_set.registry.callback.client_selection_ambiguous",
	SelectionFailed: "token_set.registry.callback.selection_failed",
} as const;

export type TokenSetRegistryCallbackErrorCode =
	(typeof TokenSetRegistryCallbackErrorCode)[keyof typeof TokenSetRegistryCallbackErrorCode];

export const TokenSetRegistryCallbackErrorSource =
	"token_set.registry.callback";

export const TokenSetCallbackClientSelectionKind = {
	NotApplicable: "not_applicable",
	Selected: "selected",
} as const;

export type TokenSetCallbackClientSelectionKind =
	(typeof TokenSetCallbackClientSelectionKind)[keyof typeof TokenSetCallbackClientSelectionKind];

export interface TokenSetCallbackClientNotApplicableSelection {
	readonly kind: typeof TokenSetCallbackClientSelectionKind.NotApplicable;
}

export interface TokenSetCallbackClientSelectedSelection<
	TClient extends BaseOidcModeClient,
> {
	readonly kind: typeof TokenSetCallbackClientSelectionKind.Selected;
	readonly client: TClient;
}

export type TokenSetCallbackClientSelection<
	TClient extends BaseOidcModeClient,
> =
	| TokenSetCallbackClientNotApplicableSelection
	| TokenSetCallbackClientSelectedSelection<TClient>;

export type TokenSetCallbackClientSelectionSignal<
	TClient extends BaseOidcModeClient,
> = ReadableSignalTrait<TokenSetCallbackClientSelectionSnapshot<TClient>>;

export type TokenSetCallbackClientSelectionSnapshot<
	TClient extends BaseOidcModeClient,
> = Extract<
	ResourceSnapshot<TokenSetCallbackClientSelection<TClient>>,
	{
		readonly status:
			| typeof ResourceStatus.Idle
			| typeof ResourceStatus.Loading
			| typeof ResourceStatus.LoadingError
			| typeof ResourceStatus.Resolved;
	}
>;

export interface TokenSetCallbackClientQueryOptions {
	readonly callbackUrl: UriReferenceString;
}

export type TokenSetCallbackClientQuery = (
	options: TokenSetCallbackClientQueryOptions,
) => TokenSetClientQueryOptions | null;

export type TokenSetCallbackClientNotFoundMapper<
	TClient extends BaseOidcModeClient,
> = (
	snapshot: ResourceLoadingErrorSnapshot,
) => TokenSetCallbackClientSelectionSnapshot<TClient>;

export interface SelectTokenSetFrontendCallbackClientFromRegistryOptions {
	readonly registry: TokenSetClientRegistry<BaseOidcModeClient>;
	readonly callbackUrl: UriReferenceStringInput;
	readonly clientQuery?: TokenSetCallbackClientQuery;
	readonly mapClientNotFound?: TokenSetCallbackClientNotFoundMapper<FrontendOidcModeClient>;
	readonly initialize?: boolean;
}

export interface SelectTokenSetBackendCallbackClientFromRegistryOptions {
	readonly registry: TokenSetClientRegistry<BaseOidcModeClient>;
	readonly callbackUrl: UriReferenceStringInput;
	readonly clientQuery?: TokenSetCallbackClientQuery;
	readonly mapClientNotFound?: TokenSetCallbackClientNotFoundMapper<BackendOidcModeClient>;
	readonly initialize?: boolean;
}

export type TokenSetFrontendCallbackClientFromRegistrySelectionSignal =
	TokenSetCallbackClientSelectionSignal<FrontendOidcModeClient>;

export type TokenSetBackendCallbackClientFromRegistrySelectionSignal =
	TokenSetCallbackClientSelectionSignal<BackendOidcModeClient>;

export const defaultTokenSetFrontendCallbackClientQuery: TokenSetCallbackClientQuery =
	({ callbackUrl }) => ({ callbackUrl });

export const defaultTokenSetBackendCallbackClientQuery: TokenSetCallbackClientQuery =
	({ callbackUrl }) => {
		const compatFragment = parseCompatFragment(callbackUrl);
		if (
			compatFragment?.parameters.kind !==
			BackendOidcModeCompatFragmentKind.Callback
		) {
			return null;
		}

		const clientKey = compatFragment.parameters.callback_routing_key;
		if (!clientKey) {
			throw new ClientError({
				kind: ClientErrorKind.Protocol,
				code: TokenSetRegistryCallbackErrorCode.RoutingKeyMissing,
				message:
					"The backend OIDC callback does not identify its owning client.",
				recovery: UserRecovery.RestartFlow,
				source: TokenSetRegistryCallbackErrorSource,
			});
		}
		return { clientKey };
	};

export function selectTokenSetFrontendCallbackClientFromRegistry({
	registry,
	callbackUrl,
	clientQuery,
	mapClientNotFound = () => ({
		status: ResourceStatus.Resolved,
		value: { kind: TokenSetCallbackClientSelectionKind.NotApplicable },
	}),
	initialize = false,
}: SelectTokenSetFrontendCallbackClientFromRegistryOptions): TokenSetFrontendCallbackClientFromRegistrySelectionSignal {
	return selectTokenSetCallbackClientFromRegistry({
		registry,
		callbackUrl,
		clientQuery: clientQuery ?? defaultTokenSetFrontendCallbackClientQuery,
		mapClientNotFound,
		initialize,
		mode: "frontend",
		expectedType: "FrontendOidcModeClient",
		isExpectedClient: (client): client is FrontendOidcModeClient =>
			client instanceof FrontendOidcModeClient,
	});
}

export function selectTokenSetBackendCallbackClientFromRegistry({
	registry,
	callbackUrl,
	clientQuery,
	mapClientNotFound = (snapshot) => snapshot,
	initialize = false,
}: SelectTokenSetBackendCallbackClientFromRegistryOptions): TokenSetBackendCallbackClientFromRegistrySelectionSignal {
	return selectTokenSetCallbackClientFromRegistry({
		registry,
		callbackUrl,
		clientQuery: clientQuery ?? defaultTokenSetBackendCallbackClientQuery,
		mapClientNotFound,
		initialize,
		mode: "backend",
		expectedType: "BackendOidcModeClient",
		isExpectedClient: (client): client is BackendOidcModeClient =>
			client instanceof BackendOidcModeClient,
	});
}

function selectTokenSetCallbackClientFromRegistry<
	TClient extends BaseOidcModeClient,
>(options: {
	readonly registry: TokenSetClientRegistry<BaseOidcModeClient>;
	readonly callbackUrl: UriReferenceStringInput;
	readonly clientQuery: TokenSetCallbackClientQuery;
	readonly mapClientNotFound: TokenSetCallbackClientNotFoundMapper<TClient>;
	readonly initialize: boolean;
	readonly mode: "frontend" | "backend";
	readonly expectedType: string;
	readonly isExpectedClient: (client: BaseOidcModeClient) => client is TClient;
}): TokenSetCallbackClientSelectionSignal<TClient> {
	try {
		const callbackUrl = UriReferenceString.parse(options.callbackUrl);
		const query = options.clientQuery({ callbackUrl });
		if (query === null) {
			return createComputed(() => ({
				status: ResourceStatus.Resolved,
				value: { kind: TokenSetCallbackClientSelectionKind.NotApplicable },
			}));
		}
		const matches = [...options.registry.clientRecordGenForQuery(query)];
		if (matches.length === 0) {
			const snapshot: ResourceLoadingErrorSnapshot = {
				status: ResourceStatus.LoadingError,
				error: createClientNotFoundError(options.mode),
			};
			return createComputed(() => options.mapClientNotFound(snapshot));
		}
		if (matches.length > 1) {
			throw new ClientError({
				kind: ClientErrorKind.Configuration,
				code: TokenSetRegistryCallbackErrorCode.ClientSelectionAmbiguous,
				message: `Multiple ${options.mode} OIDC clients match the callback URL.`,
				recovery: UserRecovery.ContactSupport,
				source: TokenSetRegistryCallbackErrorSource,
			});
		}

		return createSelectedCallbackClientSignal({
			registry: options.registry,
			clientRecord: matches[0],
			initialize: options.initialize,
			mode: options.mode,
			expectedType: options.expectedType,
			isExpectedClient: options.isExpectedClient,
		});
	} catch (error) {
		return createCallbackClientSelectionErrorSignal(error);
	}
}

function createSelectedCallbackClientSignal<
	TClient extends BaseOidcModeClient,
>(options: {
	readonly registry: TokenSetClientRegistry<BaseOidcModeClient>;
	readonly clientRecord: ReadableSignalTrait<
		TokenSetClientRecordView<BaseOidcModeClient>
	>;
	readonly initialize: boolean;
	readonly mode: "frontend" | "backend";
	readonly expectedType: string;
	readonly isExpectedClient: (client: BaseOidcModeClient) => client is TClient;
}): TokenSetCallbackClientSelectionSignal<TClient> {
	const selectedRecord = options.clientRecord.get();
	if (options.initialize) {
		options.registry.clientResourceFor(selectedRecord.meta.clientKey);
	}

	return createComputed(() => {
		const currentRecord = options.registry.clientRecordOptionFor(
			selectedRecord.meta.clientKey,
		);
		if (!currentRecord || currentRecord.get().id !== selectedRecord.id) {
			return {
				status: ResourceStatus.LoadingError,
				error: createClientNotFoundError(options.mode),
			};
		}

		const record = options.clientRecord.get();
		switch (record.status) {
			case ResourceStatus.Idle:
				return { status: ResourceStatus.Idle };
			case ResourceStatus.Loading:
				return { status: ResourceStatus.Loading };
			case ResourceStatus.LoadingError:
				return {
					status: ResourceStatus.LoadingError,
					error: record.error,
				};
			case ResourceStatus.Resolved:
				return options.isExpectedClient(record.client)
					? {
							status: ResourceStatus.Resolved,
							value: {
								kind: TokenSetCallbackClientSelectionKind.Selected,
								client: record.client,
							},
						}
					: {
							status: ResourceStatus.LoadingError,
							error: createClientModeMismatchError(
								selectedRecord.meta.clientKey,
								options.expectedType,
							),
						};
		}
	});
}

function createCallbackClientSelectionErrorSignal<
	TClient extends BaseOidcModeClient,
>(error: unknown): TokenSetCallbackClientSelectionSignal<TClient> {
	const clientError = ClientError.fromUnknown(error, {
		code: TokenSetRegistryCallbackErrorCode.SelectionFailed,
		message: "Token-set callback client selection failed.",
		source: TokenSetRegistryCallbackErrorSource,
	});
	return createComputed(() => ({
		status: ResourceStatus.LoadingError,
		error: clientError,
	}));
}

function createClientNotFoundError(mode: "frontend" | "backend"): ClientError {
	return new ClientError({
		kind: ClientErrorKind.Configuration,
		code: TokenSetRegistryCallbackErrorCode.ClientNotFound,
		message: `Cannot determine which ${mode} OIDC client owns the callback.`,
		recovery: UserRecovery.ContactSupport,
		source: TokenSetRegistryCallbackErrorSource,
	});
}

function createClientModeMismatchError(
	clientKey: string,
	expectedType: string,
): ClientError {
	return new ClientError({
		kind: ClientErrorKind.Configuration,
		code: TokenSetRegistryCallbackErrorCode.ClientModeMismatch,
		message: `Client "${clientKey}" is not a ${expectedType}.`,
		recovery: UserRecovery.ContactSupport,
		source: TokenSetRegistryCallbackErrorSource,
	});
}
