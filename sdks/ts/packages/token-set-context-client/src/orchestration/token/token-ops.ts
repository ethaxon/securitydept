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

export interface TokenFreshnessTiming {
	expiresAt: number;
	clockSkewMs: number;
	refreshWindowMs: number;
	usableUntil: number;
	refreshAt: number;
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
		accessTokenIssuedAt:
			delta.accessTokenIssuedAt ?? snapshot.accessTokenIssuedAt,
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

	const timing = resolveTokenFreshnessTiming(snapshot, options);
	const usableUntil = timing.usableUntil;
	if (usableUntil <= options.now) {
		return TokenFreshnessState.Expired;
	}

	if (timing.refreshAt <= options.now) {
		return TokenFreshnessState.RefreshDue;
	}

	return TokenFreshnessState.Fresh;
}

export function resolveTokenFreshnessTiming(
	snapshot: AuthSnapshot,
	options: TokenFreshnessOptions,
): TokenFreshnessTiming {
	const expiresAt = new Date(
		snapshot.tokens.accessTokenExpiresAt ?? "",
	).getTime();
	const issuedAt = new Date(
		snapshot.tokens.accessTokenIssuedAt ?? "",
	).getTime();

	let clockSkewMs = options.clockSkewMs;
	let refreshWindowMs = options.refreshWindowMs;
	if (
		Number.isFinite(issuedAt) &&
		Number.isFinite(expiresAt) &&
		expiresAt > issuedAt
	) {
		const lifetimeMs = expiresAt - issuedAt;
		const shortTokenCapMs = Math.max(0, lifetimeMs / 4);
		clockSkewMs = Math.min(clockSkewMs, shortTokenCapMs);
		refreshWindowMs = Math.min(refreshWindowMs, shortTokenCapMs);
	}

	const usableUntil = expiresAt - clockSkewMs;
	return {
		expiresAt,
		clockSkewMs,
		refreshWindowMs,
		usableUntil,
		refreshAt: usableUntil - refreshWindowMs,
	};
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
