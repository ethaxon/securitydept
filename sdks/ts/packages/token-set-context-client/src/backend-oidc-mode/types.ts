// Backend OIDC Mode — client-specific types
//
// Token material / metadata / snapshot / delta types are re-exported from the
// orchestration layer. Mode-specific constants and config types live here.

import type {
	AuthDelta as _AuthDelta,
	AuthMetadataDelta as _AuthMetadataDelta,
	AuthMetadataSnapshot as _AuthMetadataSnapshot,
	AuthPrincipal as _AuthPrincipal,
	AuthSnapshot as _AuthSnapshot,
	AuthSource as _AuthSource,
	TokenDelta as _TokenDelta,
	TokenSnapshot as _TokenSnapshot,
} from "../orchestration/types";
import { AuthSourceKind as _AuthSourceKind } from "../orchestration/types";

// --- Orchestration re-exports ---

/** @see {@link _AuthSourceKind} */
export const AuthenticationSourceKind = _AuthSourceKind;
export type AuthenticationSourceKind = _AuthSourceKind;

/** @see {@link _AuthSource} */
export type AuthenticationSource = _AuthSource;

/** @see {@link _AuthPrincipal} */
export type AuthenticatedPrincipal = _AuthPrincipal;

/** @see {@link _TokenSnapshot} */
export type AuthTokenSnapshot = _TokenSnapshot;

/** @see {@link _TokenDelta} */
export type AuthTokenDelta = _TokenDelta;

/** @see {@link _AuthMetadataSnapshot} */
export type AuthStateMetadataSnapshot = _AuthMetadataSnapshot;

/** @see {@link _AuthMetadataDelta} */
export type AuthStateMetadataDelta = _AuthMetadataDelta;

/** @see {@link _AuthSnapshot} */
export type AuthStateSnapshot = _AuthSnapshot;

/** @see {@link _AuthDelta} */
export type AuthStateDelta = _AuthDelta;

// --- Mode-specific constants ---

export const BackendOidcModeContextSource = {
	Client: "backend_oidc_mode_client",
	Persistence: "backend-oidc-mode",
} as const;

export type BackendOidcModeContextSource =
	(typeof BackendOidcModeContextSource)[keyof typeof BackendOidcModeContextSource];

export const BackendOidcModeStateRestoreSourceKind = {
	Manual: "manual",
	PersistentStore: "persistent_store",
} as const;

export type BackendOidcModeStateRestoreSourceKind =
	(typeof BackendOidcModeStateRestoreSourceKind)[keyof typeof BackendOidcModeStateRestoreSourceKind];

// --- Mode-specific config ---

export interface BackendOidcModeClientConfig {
	/** Base URL of the backend server that runs the OIDC flow. */
	baseUrl: string;
	/**
	 * Path to the login/authorize endpoint.
	 *
	 * SDK default: `"/auth/oidc/login"`.
	 *
	 * Adopters whose server uses a different route family (e.g.
	 * `securitydept-server` uses `"/auth/token-set/login"`) should pass the
	 * adopter-specific path here.
	 */
	loginPath?: string;
	/**
	 * Path to the token refresh endpoint.
	 *
	 * SDK default: `"/auth/oidc/refresh"`.
	 */
	refreshPath?: string;
	/**
	 * Path to the metadata redemption endpoint.
	 *
	 * SDK default: `"/auth/oidc/metadata/redeem"`.
	 */
	metadataRedeemPath?: string;
	/**
	 * Path to the user info endpoint.
	 *
	 * SDK default: `"/auth/oidc/user-info"`.
	 */
	userInfoPath?: string;
	/** Buffer before expiry to trigger refresh, in ms (default: 60000 = 1 minute). */
	refreshWindowMs?: number;
	/** Optional key used with `runtime.persistentStore` for persisted auth state. */
	persistentStateKey?: string;
	/** Optional default redirect URI reused by authorize/refresh browser flows. */
	defaultPostAuthRedirectUri?: string;
}
