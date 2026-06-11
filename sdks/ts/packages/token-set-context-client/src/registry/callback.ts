import {
	ClientError,
	ClientErrorKind,
	parseCompatFragment,
	type ReadableSignalTrait,
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
	readonly clientRecord: ReadableSignalTrait<
		TokenSetClientRecordView<BaseOidcModeClient>
	>;
	readonly clientResolver: () => Promise<TClient>;
}

export type TokenSetCallbackClientSelection<
	TClient extends BaseOidcModeClient,
> =
	| TokenSetCallbackClientNotApplicableSelection
	| TokenSetCallbackClientSelectedSelection<TClient>;

export interface SelectTokenSetFrontendCallbackClientFromRegistryOptions {
	readonly registry: TokenSetClientRegistry<BaseOidcModeClient>;
	readonly callbackUrl: string;
	readonly clientQuery?: TokenSetClientQueryOptions;
}

export interface SelectTokenSetBackendCallbackClientFromRegistryOptions {
	readonly registry: TokenSetClientRegistry<BaseOidcModeClient>;
	readonly callbackUrl: string;
}

export type TokenSetFrontendCallbackClientFromRegistrySelection =
	TokenSetCallbackClientSelection<FrontendOidcModeClient>;

export type TokenSetBackendCallbackClientFromRegistrySelection =
	TokenSetCallbackClientSelection<BackendOidcModeClient>;

export function selectTokenSetFrontendCallbackClientFromRegistry({
	registry,
	callbackUrl,
	clientQuery,
}: SelectTokenSetFrontendCallbackClientFromRegistryOptions): TokenSetFrontendCallbackClientFromRegistrySelection {
	const query: TokenSetClientQueryOptions = !clientQuery
		? { callbackUrl }
		: Array.isArray(clientQuery)
			? clientQuery.map((filter) => ({ callbackUrl, ...filter }))
			: { callbackUrl, ...clientQuery };
	const matches = [...registry.clientRecordGenForQuery(query)];
	if (matches.length === 0) {
		return { kind: TokenSetCallbackClientSelectionKind.NotApplicable };
	}
	if (matches.length > 1) {
		throw new ClientError({
			kind: ClientErrorKind.Configuration,
			code: TokenSetRegistryCallbackErrorCode.ClientSelectionAmbiguous,
			message: "Multiple frontend OIDC clients match the callback URL.",
			recovery: UserRecovery.ContactSupport,
			source: TokenSetRegistryCallbackErrorSource,
		});
	}

	const clientRecord = matches[0];
	const selectedRecord = clientRecord.get();
	return {
		kind: TokenSetCallbackClientSelectionKind.Selected,
		clientRecord,
		clientResolver: async () => {
			const readyRecord = await registry.clientRecordOptionFor(
				selectedRecord.meta.clientKey,
				{ initialize: true },
			);
			if (!readyRecord || readyRecord.id !== selectedRecord.id) {
				throw createClientNotFoundError("frontend");
			}
			if (!(readyRecord.client instanceof FrontendOidcModeClient)) {
				throw createClientModeMismatchError(
					selectedRecord.meta.clientKey,
					"FrontendOidcModeClient",
				);
			}
			return readyRecord.client;
		},
	};
}

export function selectTokenSetBackendCallbackClientFromRegistry({
	registry,
	callbackUrl,
}: SelectTokenSetBackendCallbackClientFromRegistryOptions): TokenSetBackendCallbackClientFromRegistrySelection {
	const compatFragment = parseCompatFragment(callbackUrl);
	if (
		compatFragment?.parameters.kind !==
		BackendOidcModeCompatFragmentKind.Callback
	) {
		return { kind: TokenSetCallbackClientSelectionKind.NotApplicable };
	}

	const clientKey = compatFragment.parameters.callback_routing_key;
	if (!clientKey) {
		throw new ClientError({
			kind: ClientErrorKind.Protocol,
			code: TokenSetRegistryCallbackErrorCode.RoutingKeyMissing,
			message: "The backend OIDC callback does not identify its owning client.",
			recovery: UserRecovery.RestartFlow,
			source: TokenSetRegistryCallbackErrorSource,
		});
	}

	const clientRecord = registry.clientRecordOptionFor(clientKey);
	if (!clientRecord) {
		throw createClientNotFoundError("backend");
	}
	const selectedRecord = clientRecord.get();
	return {
		kind: TokenSetCallbackClientSelectionKind.Selected,
		clientRecord,
		clientResolver: async () => {
			const readyRecord = await registry.clientRecordOptionFor(clientKey, {
				initialize: true,
			});
			if (!readyRecord || readyRecord.id !== selectedRecord.id) {
				throw createClientNotFoundError("backend");
			}
			if (!(readyRecord.client instanceof BackendOidcModeClient)) {
				throw createClientModeMismatchError(clientKey, "BackendOidcModeClient");
			}
			return readyRecord.client;
		},
	};
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
