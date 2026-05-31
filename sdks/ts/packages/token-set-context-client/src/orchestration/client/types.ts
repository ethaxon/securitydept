import {
	type FoundationEnvironment,
	type ReadableSignalTrait,
	type StorageTrait,
} from "@securitydept/client";
import { type TokenFreshnessOptions } from "../token/freshness";
import { type AuthSnapshot } from "../token/types";
import { type AuthWorkflowRuntimeOptions } from "./workflows/source";

export interface OidcRedirectLoginOptions {
	/**
	 * Where to redirect the user after successful authentication.
	 *
	 * When omitted, the client-specific default is used.
	 */
	postAuthRedirectUri?: string;
}

export interface OidcPopupLoginOptions {
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

export interface OidcPopupLoginResult {
	/** The auth state snapshot produced by the popup callback. */
	snapshot: AuthSnapshot;
}

export interface BaseOidcModeClientTracingOptions {
	target: string;
	prefix: string;
}

export interface BaseOidcModeClientDefaultOptions {
	tokenFreshness: TokenFreshnessOptions;
}

export interface BaseOidcModeClientOptions {
	environment: FoundationEnvironment;
	refresh?: Partial<AuthWorkflowRuntimeOptions>;
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

export const StateRestoreSourceKind = {
	Manual: "manual",
	PersistentStore: "persistent_store",
} as const;

export type StateRestoreSourceKind =
	(typeof StateRestoreSourceKind)[keyof typeof StateRestoreSourceKind];

export interface TokenSetAuthOperationSignals {
	readonly restorePending: ReadableSignalTrait<boolean>;
	readonly refreshPending: ReadableSignalTrait<boolean>;
	readonly clearPending: ReadableSignalTrait<boolean>;
	readonly loginPending: ReadableSignalTrait<boolean>;
}
