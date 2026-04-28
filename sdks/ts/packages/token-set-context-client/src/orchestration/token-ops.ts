import type { AuthSnapshot, TokenDelta, TokenSnapshot } from "./types";

export const TokenFreshnessState = {
	Fresh: "fresh",
	RefreshDue: "refresh_due",
	Expired: "expired",
	NoExpiry: "no_expiry",
} as const;

export type TokenFreshnessState =
	(typeof TokenFreshnessState)[keyof typeof TokenFreshnessState];

export interface TokenFreshnessOptions {
	now: number;
	clockSkewMs: number;
	refreshWindowMs: number;
}

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

export function getTokenFreshness(
	snapshot: AuthSnapshot | null | undefined,
	options: TokenFreshnessOptions,
): TokenFreshnessState {
	const expiresAtRaw = snapshot?.tokens.accessTokenExpiresAt;
	if (!snapshot?.tokens.accessToken) {
		return TokenFreshnessState.Expired;
	}
	if (!expiresAtRaw) {
		return TokenFreshnessState.NoExpiry;
	}

	const expiresAt = new Date(expiresAtRaw).getTime();
	if (!Number.isFinite(expiresAt)) {
		return TokenFreshnessState.Expired;
	}

	const usableUntil = expiresAt - options.clockSkewMs;
	if (usableUntil <= options.now) {
		return TokenFreshnessState.Expired;
	}

	if (usableUntil - options.refreshWindowMs <= options.now) {
		return TokenFreshnessState.RefreshDue;
	}

	return TokenFreshnessState.Fresh;
}

export function isAccessTokenUsable(
	snapshot: AuthSnapshot | null | undefined,
	options: TokenFreshnessOptions,
): boolean {
	const freshness = getTokenFreshness(snapshot, options);
	return (
		freshness === TokenFreshnessState.Fresh ||
		freshness === TokenFreshnessState.RefreshDue ||
		freshness === TokenFreshnessState.NoExpiry
	);
}

export function shouldRefreshAccessToken(
	snapshot: AuthSnapshot | null | undefined,
	options: TokenFreshnessOptions,
): boolean {
	const freshness = getTokenFreshness(snapshot, options);
	return (
		(snapshot?.tokens.refreshMaterial !== undefined &&
			(freshness === TokenFreshnessState.RefreshDue ||
				freshness === TokenFreshnessState.Expired)) ??
		false
	);
}

export function freshBearerHeader(
	snapshot: AuthSnapshot | null | undefined,
	options: TokenFreshnessOptions,
): string | null {
	if (!isAccessTokenUsable(snapshot, options)) {
		return null;
	}
	return bearerHeader(snapshot?.tokens);
}
