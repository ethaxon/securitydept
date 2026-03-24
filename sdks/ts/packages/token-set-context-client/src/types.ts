// --- Token Set Context Client types ---
// Aligned with server-side models from token-set-context crate.

export const AuthenticationSourceKind = {
	OidcAuthorizationCode: "oidc_authorization_code",
	RefreshToken: "refresh_token",
	ForwardedBearer: "forwarded_bearer",
	StaticToken: "static_token",
	Unknown: "unknown",
} as const;

export type AuthenticationSourceKind =
	(typeof AuthenticationSourceKind)[keyof typeof AuthenticationSourceKind];

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

export interface AuthenticationSource {
	kind: AuthenticationSourceKind;
	providerId?: string;
	issuer?: string;
	kindHistory?: AuthenticationSourceKind[];
	attributes?: Record<string, unknown>;
}

export interface AuthenticatedPrincipal {
	subject: string;
	displayName: string;
	picture?: string;
	issuer?: string;
	claims?: Record<string, unknown>;
}

export interface AuthTokenSnapshot {
	accessToken: string;
	idToken?: string;
	refreshMaterial?: string;
	accessTokenExpiresAt?: string;
}

export interface AuthTokenDelta {
	accessToken: string;
	idToken?: string;
	refreshMaterial?: string;
	accessTokenExpiresAt?: string;
}

export interface AuthStateMetadataSnapshot {
	principal?: AuthenticatedPrincipal;
	source?: AuthenticationSource;
	attributes?: Record<string, unknown>;
}

export interface AuthStateMetadataDelta {
	principal?: AuthenticatedPrincipal;
	source?: AuthenticationSource;
	attributes?: Record<string, unknown>;
}

export interface AuthStateSnapshot {
	tokens: AuthTokenSnapshot;
	metadata: AuthStateMetadataSnapshot;
}

export interface AuthStateDelta {
	tokens: AuthTokenDelta;
	metadata?: AuthStateMetadataDelta;
}

// --- Transport DTOs ---

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

// --- Config ---

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
