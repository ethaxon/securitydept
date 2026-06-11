import {
	type CancellationTokenOptions,
	type CancellationTokenTrait,
	type FoundationEnvironment,
	type ReadableSignalTrait,
	type ResourceSnapshot,
	type ResourceTrait,
	type StorageTrait,
} from "@securitydept/client";
import { type TokenSetTokenFreshnessOptions } from "../token/freshness";
import { type TokenSetAuthSnapshot } from "../token/types";
import { type PersistPolicy } from "./workflows/commit";
import { type TokenSetAuthWorkflowRuntimeOptions } from "./workflows/source";

export interface TokenSetOidcRedirectLoginOptions
	extends CancellationTokenOptions {
	/**
	 * Where to redirect the user after successful authentication.
	 *
	 * When omitted, the client-specific default is used.
	 */
	postAuthRedirectUri?: string;
}

export interface TokenSetOidcPopupLoginOptions
	extends CancellationTokenOptions {
	/**
	 * The popup callback URL. This page should relay the callback URL back to
	 * the opener through the token-set popup relay helper for the selected mode.
	 */
	popupCallbackUrl: string;
	/** Popup window width in pixels. */
	popupWidth?: number;
	/** Popup window height in pixels. */
	popupHeight?: number;
	/** Maximum time in ms to wait for the popup relay. */
	timeoutMs?: number;
}

export interface TokenSetAuthStateOperationOptions
	extends CancellationTokenOptions {
	persistPolicy?: PersistPolicy;
}

export interface TokenSetOidcPopupLoginResult {
	/** The auth state snapshot produced by the popup callback. */
	snapshot: TokenSetAuthSnapshot;
}

export interface BaseOidcModeClientTracingOptions {
	target: string;
	prefix: string;
}

export const OidcModeCallbackHandlingKind = {
	NotApplicable: "not_applicable",
	Handled: "handled",
} as const;

export type OidcModeCallbackHandlingKind =
	(typeof OidcModeCallbackHandlingKind)[keyof typeof OidcModeCallbackHandlingKind];

export type OidcModeCallbackHandlingResult<TResult> =
	| {
			readonly kind: typeof OidcModeCallbackHandlingKind.NotApplicable;
	  }
	| {
			readonly kind: typeof OidcModeCallbackHandlingKind.Handled;
			readonly result: TResult;
	  };

export interface OidcModeCallbackInputResolverOptions {
	readonly environment: FoundationEnvironment;
	readonly cancellationToken: CancellationTokenTrait;
}

export type OidcModeCallbackInputResolver<TInput> = (
	options: OidcModeCallbackInputResolverOptions,
) => TInput | null | Promise<TInput | null>;

export interface OidcModeCallbackStateTrait<TResult> {
	readonly state: ReadableSignalTrait<
		ResourceSnapshot<OidcModeCallbackHandlingResult<TResult>>
	>;
	readonly resource: ResourceTrait<OidcModeCallbackHandlingResult<TResult>>;
	cancel(): void;
}

export interface BaseOidcModeClientDefaultOptions {
	tokenFreshness: TokenSetTokenFreshnessOptions;
}

export interface BaseOidcModeClientOptions {
	environment: FoundationEnvironment;
	refresh?: Partial<TokenSetAuthWorkflowRuntimeOptions>;
	tracing: BaseOidcModeClientTracingOptions;
	id?: string;
	persistence?: {
		store: StorageTrait;
		key: string;
	};
	autoStart?: boolean;
}

/**
 * Mode client config fields aligned with {@link BaseOidcModeClientOptions}.
 *
 * `environment` and `tracing` are supplied at construction time; persistence
 * store is resolved from the environment while the config may override the key.
 */
export type OidcModeClientConfigBase = Omit<
	BaseOidcModeClientOptions,
	"environment" | "tracing" | "persistence"
> & {
	persistence?: Pick<
		NonNullable<BaseOidcModeClientOptions["persistence"]>,
		"key"
	>;
};

export const TokenSetStateRestoreSourceKind = {
	Manual: "manual",
	PersistentStore: "persistent_store",
} as const;

export type TokenSetStateRestoreSourceKind =
	(typeof TokenSetStateRestoreSourceKind)[keyof typeof TokenSetStateRestoreSourceKind];

export interface TokenSetAuthOperationSignals {
	readonly restorePending: ReadableSignalTrait<boolean>;
	readonly refreshPending: ReadableSignalTrait<boolean>;
	readonly clearPending: ReadableSignalTrait<boolean>;
	readonly loginPending: ReadableSignalTrait<boolean>;
}
