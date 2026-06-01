import { type IdentityPrincipal } from "@securitydept/client";

// --- Generic Token Orchestration types ---
// These types describe token material shape, snapshot/delta semantics,
// and metadata shape without binding to any specific token acquisition
// protocol (OIDC authorization code, OIDC-mediated sealed flow, etc.).

/**
 * A point-in-time snapshot of token material.
 *
 * This is protocol-agnostic: it does not know whether the tokens were
 * obtained via standard OIDC, a OIDC-mediated sealed callback, or any other
 * mechanism.
 */
export interface TokenSetTokenSnapshot {
	accessToken: string;
	idToken?: string;
	refreshMaterial?: string;
	accessTokenIssuedAt?: string;
	accessTokenExpiresAt?: string;
}

/**
 * A delta update to token material (e.g. from a refresh).
 *
 * Fields present in the delta override the corresponding snapshot fields.
 * Fields absent preserve the prior snapshot value.
 */
export interface TokenSetTokenDelta {
	accessToken: string;
	idToken?: string;
	refreshMaterial?: string;
	accessTokenIssuedAt?: string;
	accessTokenExpiresAt?: string;
}

/**
 * Metadata about the authenticated principal, independent of how the
 * tokens were obtained.
 */
export type TokenSetAuthPrincipal = IdentityPrincipal;

/**
 * Authentication source descriptor.
 */
export interface TokenSetAuthSource {
	kind: TokenSetAuthSourceKind;
	providerId?: string;
	issuer?: string;
	kindHistory?: TokenSetAuthSourceKind[];
	attributes?: Record<string, unknown>;
}

export const TokenSetAuthSourceKind = {
	OidcAuthorizationCode: "oidc_authorization_code",
	RefreshToken: "refresh_token",
	ForwardedBearer: "forwarded_bearer",
	StaticToken: "static_token",
	Unknown: "unknown",
} as const;

export type TokenSetAuthSourceKind =
	(typeof TokenSetAuthSourceKind)[keyof typeof TokenSetAuthSourceKind];

/**
 * Metadata snapshot that accompanies a token snapshot.
 */
export interface TokenSetAuthMetadataSnapshot {
	principal?: TokenSetAuthPrincipal;
	source?: TokenSetAuthSource;
	attributes?: Record<string, unknown>;
}

/**
 * A delta update to auth metadata.
 */
export interface TokenSetAuthMetadataDelta {
	principal?: TokenSetAuthPrincipal;
	source?: TokenSetAuthSource;
	attributes?: Record<string, unknown>;
}

/**
 * Combined token + metadata snapshot — the primary auth state atom.
 */
export interface TokenSetAuthSnapshot {
	tokens: TokenSetTokenSnapshot;
	metadata: TokenSetAuthMetadataSnapshot;
}

/**
 * Combined token + metadata delta.
 */
export interface TokenSetAuthDelta {
	tokens: TokenSetTokenDelta;
	metadata?: TokenSetAuthMetadataDelta;
}
