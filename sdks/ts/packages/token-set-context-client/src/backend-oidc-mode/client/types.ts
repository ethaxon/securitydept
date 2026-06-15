// Backend OIDC Mode — client-specific types
//
// Mode-specific constants and config types live here. Shared token/auth
// material types are exported from the orchestration layer.

import {
	type CancellationTokenOptions,
	type FoundationEnvironment,
} from "@securitydept/client";
import {
	type BaseOidcModeClientDefaultOptions,
	type OidcModeCallbackResolutionOptions,
	type OidcModeClientConfigBase,
} from "../../orchestration/client/types";
import { type BackendOidcModeCallbackInput } from "../contracts/callback";

// --- Mode-specific constants ---

export const BackendOidcModeContextSource = {
	Client: "backend_oidc_mode_client",
	Persistence: "backend-oidc-mode",
} as const;

export type BackendOidcModeContextSource =
	(typeof BackendOidcModeContextSource)[keyof typeof BackendOidcModeContextSource];

// --- Mode-specific config ---

export interface BackendOidcModeClientConfig extends OidcModeClientConfigBase {
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
	/** Optional default redirect URI reused by authorize/refresh browser flows. */
	defaultPostAuthRedirectUri?: string;
}

export type BackendOidcModeClientOptions = {
	readonly config: BackendOidcModeClientConfig;
	readonly environment: FoundationEnvironment;
	readonly callbackRoutingKey?: string;
} & OidcModeCallbackResolutionOptions<BackendOidcModeCallbackInput>;

export interface BackendOidcModeFetchUserInfoOptions
	extends CancellationTokenOptions {}

export interface BackendOidcModeMetadataRedemptionOptions
	extends CancellationTokenOptions {}

export interface BackendOidcModeClientDefaultOptions
	extends BaseOidcModeClientDefaultOptions {
	loginPath: string;
	refreshPath: string;
	metadataRedeemPath: string;
	userInfoPath: string;
	persistenceKeyPrefix: string;
}

export interface ResolvedBackendOidcModeClientConfig
	extends BackendOidcModeClientConfig {
	baseUrl: string;
	loginPath: string;
	refreshPath: string;
	metadataRedeemPath: string;
	userInfoPath: string;
}
