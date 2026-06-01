import { type TokenSetTokenSnapshot } from "./types";

export interface TokenSetTokenFreshnessOptions {
	clockSkewMs: number;
	refreshWindowMs: number;
}

export const TokenSetTokenFreshnessState = {
	Fresh: "fresh",
	RefreshDue: "refresh_due",
	Expired: "expired",
	NoExpiry: "no_expiry",
} as const;

export type TokenSetTokenFreshnessState =
	(typeof TokenSetTokenFreshnessState)[keyof typeof TokenSetTokenFreshnessState];

export interface TokenSetTokenFreshnessFresh {
	state: typeof TokenSetTokenFreshnessState.Fresh;
}

export interface TokenSetTokenFreshnessRefreshDue {
	state: typeof TokenSetTokenFreshnessState.RefreshDue;
	refreshAt: number;
}

export interface TokenSetTokenFreshnessExpired {
	state: typeof TokenSetTokenFreshnessState.Expired;
}

export interface TokenSetTokenFreshnessNoExpiry {
	state: typeof TokenSetTokenFreshnessState.NoExpiry;
}

export interface TokenSetTokenFreshnessTimingWithExpiryInfo {
	state:
		| typeof TokenSetTokenFreshnessState.Fresh
		| typeof TokenSetTokenFreshnessState.Expired
		| typeof TokenSetTokenFreshnessState.RefreshDue;
	now: number;
	expiresAt: number;
	usableUntil: number;
	issuedAt?: number;
	clockSkew: number;
	refreshWindow: number;
	refreshAt: number;
	options: TokenSetTokenFreshnessOptions;
}

export interface TokenSetTokenFreshnessTimingWithoutExpiryInfo {
	state: typeof TokenSetTokenFreshnessState.NoExpiry;
	now: number;
	options: TokenSetTokenFreshnessOptions;
	clockSkew: number;
	refreshWindow: number;
}

export type TokenSetTokenFreshnessTiming =
	| TokenSetTokenFreshnessTimingWithExpiryInfo
	| TokenSetTokenFreshnessTimingWithoutExpiryInfo;

export function getTokenSetAccessTokenFreshnessTiming(
	accessTokenMetadata: Pick<
		TokenSetTokenSnapshot,
		"accessTokenIssuedAt" | "accessTokenExpiresAt"
	>,
	now: number,
	options: TokenSetTokenFreshnessOptions,
): TokenSetTokenFreshnessTiming {
	const parsedExpiresAt = new Date(
		accessTokenMetadata.accessTokenExpiresAt ?? "",
	).getTime();
	const parsedIssuedAt = new Date(
		accessTokenMetadata.accessTokenIssuedAt ?? "",
	).getTime();
	const expiresAt = Number.isFinite(parsedExpiresAt)
		? parsedExpiresAt
		: undefined;
	const issuedAt = Number.isFinite(parsedIssuedAt) ? parsedIssuedAt : undefined;
	let clockSkew = options.clockSkewMs;
	let refreshWindow = options.refreshWindowMs;
	if (expiresAt && issuedAt && expiresAt > issuedAt) {
		const lifetimeMs = expiresAt - issuedAt;
		const shortTokenCapMs = Math.max(0, lifetimeMs / 4);
		clockSkew = Math.min(clockSkew, shortTokenCapMs);
		refreshWindow = Math.min(refreshWindow, shortTokenCapMs);
	}
	const usableUntil = expiresAt ? expiresAt - clockSkew : undefined;
	const refreshAt = usableUntil ? usableUntil - refreshWindow : undefined;

	if (!expiresAt || !usableUntil || !refreshAt) {
		return {
			state: TokenSetTokenFreshnessState.NoExpiry,
			now,
			options,
			clockSkew,
			refreshWindow,
		};
	}
	let freshness: TokenSetTokenFreshnessState;

	if (usableUntil <= now) {
		freshness = TokenSetTokenFreshnessState.Expired;
	} else if (refreshAt <= now) {
		freshness = TokenSetTokenFreshnessState.RefreshDue;
	} else {
		freshness = TokenSetTokenFreshnessState.Fresh;
	}

	return {
		state: freshness,
		now,
		expiresAt,
		usableUntil,
		issuedAt,
		clockSkew,
		refreshWindow,
		refreshAt,
		options,
	};
}
