import type { TokenDelta, TokenSnapshot } from "./types";

/**
 * Merge a token delta into an existing snapshot.
 *
 * This is a generic token material operation: it does not care whether
 * the delta came from a token-set callback fragment, a standard OIDC
 * token refresh response, or any other source.
 *
 * Fields present in the delta override the snapshot.
 * Fields absent in the delta preserve the snapshot value.
 */
export function mergeTokenDelta(
	snapshot: TokenSnapshot,
	delta: TokenDelta,
): TokenSnapshot {
	return {
		accessToken: delta.accessToken,
		idToken: delta.idToken ?? snapshot.idToken,
		refreshMaterial: delta.refreshMaterial ?? snapshot.refreshMaterial,
		accessTokenExpiresAt:
			delta.accessTokenExpiresAt ?? snapshot.accessTokenExpiresAt,
	};
}

/**
 * Get the bearer authorization header value from a token snapshot.
 *
 * Returns null if no snapshot is provided.
 */
export function bearerHeader(
	snapshot: TokenSnapshot | null | undefined,
): string | null {
	if (!snapshot) {
		return null;
	}
	return `Bearer ${snapshot.accessToken}`;
}
