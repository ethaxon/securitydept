import { type TokenDelta, type TokenSnapshot } from "./types";

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
		accessTokenIssuedAt:
			delta.accessTokenIssuedAt ?? snapshot.accessTokenIssuedAt,
		accessTokenExpiresAt:
			delta.accessTokenExpiresAt ?? snapshot.accessTokenExpiresAt,
	};
}

export function bearerHeader(tokens: undefined): undefined;
export function bearerHeader(tokens: TokenSnapshot): string;
export function bearerHeader(
	tokens: TokenSnapshot | undefined,
): string | undefined;
export function bearerHeader(
	tokens: TokenSnapshot | undefined,
): string | undefined {
	if (typeof tokens?.accessToken === "string") {
		return `Bearer ${tokens.accessToken}`;
	}
	return undefined;
}
