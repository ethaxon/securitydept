// --- Token Set Context Client types ---
// Aligned with server-side models from token-set-context crate.
//
// Token material / metadata / snapshot / delta types are now re-exported
// from the internal orchestration layer. These are protocol-agnostic
// types that do not depend on token-set sealed flow specifics.
//
// Token-set specific types (config, transport DTOs, context source
// constants) remain defined here because they express token-set
// protocol semantics.

// Re-export generic token orchestration types under their v1 names.
// This keeps the public API fully backward compatible.
import type {
	AuthDelta as _AuthDelta,
	AuthMetadataDelta as _AuthMetadataDelta,
	AuthMetadataSnapshot as _AuthMetadataSnapshot,
	AuthPrincipal as _AuthPrincipal,
	AuthSnapshot as _AuthSnapshot,
	AuthSource as _AuthSource,
	TokenDelta as _TokenDelta,
	TokenSnapshot as _TokenSnapshot,
} from "./orchestration/types";
import { AuthSourceKind as _AuthSourceKind } from "./orchestration/types";

// --- v1 re-exports (backward compatible aliases) ---

/** @see {@link _AuthSourceKind} - re-exported from orchestration layer */
export const AuthenticationSourceKind = _AuthSourceKind;
export type AuthenticationSourceKind = _AuthSourceKind;

/** @see {@link _AuthSource} - re-exported from orchestration layer */
export type AuthenticationSource = _AuthSource;

/** @see {@link _AuthPrincipal} - re-exported from orchestration layer */
export type AuthenticatedPrincipal = _AuthPrincipal;

/** @see {@link _TokenSnapshot} - re-exported from orchestration layer */
export type AuthTokenSnapshot = _TokenSnapshot;

/** @see {@link _TokenDelta} - re-exported from orchestration layer */
export type AuthTokenDelta = _TokenDelta;

/** @see {@link _AuthMetadataSnapshot} - re-exported from orchestration layer */
export type AuthStateMetadataSnapshot = _AuthMetadataSnapshot;

/** @see {@link _AuthMetadataDelta} - re-exported from orchestration layer */
export type AuthStateMetadataDelta = _AuthMetadataDelta;

/** @see {@link _AuthSnapshot} - re-exported from orchestration layer */
export type AuthStateSnapshot = _AuthSnapshot;

/** @see {@link _AuthDelta} - re-exported from orchestration layer */
export type AuthStateDelta = _AuthDelta;

// --- Token-set specific constants ---
// These are token-set protocol specific and stay in this file.

export const TokenSetContextSource = {
	Client: "token_set_context_client",
	Persistence: "token-set-context",
} as const;

export type TokenSetContextSource =
	(typeof TokenSetContextSource)[keyof typeof TokenSetContextSource];

export const TokenSetStateRestoreSourceKind = {
	Manual: "manual",
	PersistentStore: "persistent_store",
} as const;

export type TokenSetStateRestoreSourceKind =
	(typeof TokenSetStateRestoreSourceKind)[keyof typeof TokenSetStateRestoreSourceKind];

// --- Token-set specific transport DTOs ---

export interface TokenRefreshPayload {
	refreshToken: string;
	postAuthRedirectUri?: string;
	idToken?: string;
	currentMetadataSnapshot?: AuthStateMetadataSnapshot;
}

export interface TokenSetAuthorizeQuery {
	postAuthRedirectUri?: string;
}

export interface MetadataRedemptionRequest {
	metadataRedemptionId: string;
}

export interface MetadataRedemptionResponse {
	metadata: AuthStateMetadataSnapshot | AuthStateMetadataDelta;
}

// --- Token-set specific config ---

export interface TokenSetContextClientConfig {
	/** Base URL of the SecurityDept server. */
	baseUrl: string;
	/** Path to login/authorize endpoint (default: "/auth/token-set/login"). */
	loginPath?: string;
	/** Path to callback page (default: "/auth/token-set/callback"). */
	callbackPath?: string;
	/** Path to token refresh endpoint (default: "/auth/token-set/refresh"). */
	refreshPath?: string;
	/** Path to metadata redemption endpoint (default: "/auth/token-set/metadata/redeem"). */
	metadataRedeemPath?: string;
	/** Buffer before expiry to trigger refresh, in ms (default: 60000 = 1 minute). */
	refreshWindowMs?: number;
	/** Optional key used with `runtime.persistentStore` for persisted auth state. */
	persistentStateKey?: string;
	/** Optional default redirect URI reused by authorize/refresh browser flows. */
	defaultPostAuthRedirectUri?: string;
}
