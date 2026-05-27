import { type TokenSnapshot } from "./types";

export interface TokenFreshnessOptions {
	clockSkewMs: number;
	refreshWindowMs: number;
}

export const TokenFreshnessState = {
	Fresh: "fresh",
	RefreshDue: "refresh_due",
	Expired: "expired",
	NoExpiry: "no_expiry",
} as const;

export type TokenFreshnessState =
	(typeof TokenFreshnessState)[keyof typeof TokenFreshnessState];

export interface TokenFreshnessFresh {
	state: typeof TokenFreshnessState.Fresh;
}

export interface TokenFreshnessRefreshDue {
	state: typeof TokenFreshnessState.RefreshDue;
	refreshAt: number;
}

export interface TokenFreshnessExpired {
	state: typeof TokenFreshnessState.Expired;
}

export interface TokenFreshnessNoExpiry {
	state: typeof TokenFreshnessState.NoExpiry;
}

export interface TokenFreshnessTimingWithExpiryInfo {
	state:
		| typeof TokenFreshnessState.Fresh
		| typeof TokenFreshnessState.Expired
		| typeof TokenFreshnessState.RefreshDue;
	now: number;
	expiresAt: number;
	usableUntil: number;
	issuedAt?: number;
	clockSkew: number;
	refreshWindow: number;
	refreshAt: number;
	options: TokenFreshnessOptions;
}

export interface TokenFreshnessTimingWithoutExpiryInfo {
	state: typeof TokenFreshnessState.NoExpiry;
	now: number;
	options: TokenFreshnessOptions;
	clockSkew: number;
	refreshWindow: number;
}

export type TokenFreshnessTiming =
	| TokenFreshnessTimingWithExpiryInfo
	| TokenFreshnessTimingWithoutExpiryInfo;

export function getAccessTokenFreshnessTiming(
	accessTokenMetadata: Pick<
		TokenSnapshot,
		"accessTokenIssuedAt" | "accessTokenExpiresAt"
	>,
	now: number,
	options: TokenFreshnessOptions,
): TokenFreshnessTiming {
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
			state: TokenFreshnessState.NoExpiry,
			now,
			options,
			clockSkew,
			refreshWindow,
		};
	}
	let freshness: TokenFreshnessState;

	if (usableUntil <= now) {
		freshness = TokenFreshnessState.Expired;
	} else if (refreshAt <= now) {
		freshness = TokenFreshnessState.RefreshDue;
	} else {
		freshness = TokenFreshnessState.Fresh;
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
