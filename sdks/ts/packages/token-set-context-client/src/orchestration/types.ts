import type { AuthenticatedPrincipal } from "@securitydept/client";

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
export interface TokenSnapshot {
	accessToken: string;
	idToken?: string;
	refreshMaterial?: string;
	accessTokenExpiresAt?: string;
}

/**
 * A delta update to token material (e.g. from a refresh).
 *
 * Fields present in the delta override the corresponding snapshot fields.
 * Fields absent preserve the prior snapshot value.
 */
export interface TokenDelta {
	accessToken: string;
	idToken?: string;
	refreshMaterial?: string;
	accessTokenExpiresAt?: string;
}

/**
 * Metadata about the authenticated principal, independent of how the
 * tokens were obtained.
 */
export type AuthPrincipal = AuthenticatedPrincipal;

/**
 * Authentication source descriptor.
 */
export interface AuthSource {
	kind: AuthSourceKind;
	providerId?: string;
	issuer?: string;
	kindHistory?: AuthSourceKind[];
	attributes?: Record<string, unknown>;
}

export const AuthSourceKind = {
	OidcAuthorizationCode: "oidc_authorization_code",
	RefreshToken: "refresh_token",
	ForwardedBearer: "forwarded_bearer",
	StaticToken: "static_token",
	Unknown: "unknown",
} as const;

export type AuthSourceKind =
	(typeof AuthSourceKind)[keyof typeof AuthSourceKind];

/**
 * Metadata snapshot that accompanies a token snapshot.
 */
export interface AuthMetadataSnapshot {
	principal?: AuthPrincipal;
	source?: AuthSource;
	attributes?: Record<string, unknown>;
}

/**
 * A delta update to auth metadata.
 */
export interface AuthMetadataDelta {
	principal?: AuthPrincipal;
	source?: AuthSource;
	attributes?: Record<string, unknown>;
}

/**
 * Combined token + metadata snapshot — the primary auth state atom.
 */
export interface AuthSnapshot {
	tokens: TokenSnapshot;
	metadata: AuthMetadataSnapshot;
}

/**
 * Combined token + metadata delta.
 */
export interface AuthDelta {
	tokens: TokenDelta;
	metadata?: AuthMetadataDelta;
}
