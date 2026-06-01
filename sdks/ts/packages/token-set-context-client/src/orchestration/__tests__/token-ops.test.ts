import { describe, expect, it } from "vitest";
import {
	getTokenSetAccessTokenFreshnessTiming,
	type TokenSetTokenFreshnessOptions,
	TokenSetTokenFreshnessState,
} from "../token/freshness";
import { tokenSetBearerHeader } from "../token/ops";
import { type TokenSetAuthSnapshot } from "../token/types";

const NOW = Date.parse("2026-01-01T00:00:00Z");
const OPTIONS = {
	now: NOW,
	clockSkewMs: 30_000,
	refreshWindowMs: 60_000,
} satisfies TokenSetTokenFreshnessOptions & { now: number };

function snapshot(
	options: Partial<TokenSetAuthSnapshot["tokens"]>,
): TokenSetAuthSnapshot {
	return {
		tokens: {
			accessToken: "at",
			...options,
		},
		metadata: {},
	};
}

function getTokenFreshnessState(
	authSnapshot: TokenSetAuthSnapshot,
	options: typeof OPTIONS,
): TokenSetTokenFreshnessState {
	return getTokenSetAccessTokenFreshnessTiming(
		authSnapshot.tokens,
		options.now,
		options,
	).state;
}

describe("token freshness operations", () => {
	it("classifies fresh, refresh-due, expired, no-expiry, and invalid expiry tokens", () => {
		expect(
			getTokenFreshnessState(
				snapshot({ accessTokenExpiresAt: "2026-01-01T00:05:00Z" }),
				OPTIONS,
			),
		).toBe(TokenSetTokenFreshnessState.Fresh);
		expect(
			getTokenFreshnessState(
				snapshot({ accessTokenExpiresAt: "2026-01-01T00:01:20Z" }),
				OPTIONS,
			),
		).toBe(TokenSetTokenFreshnessState.RefreshDue);
		expect(
			getTokenFreshnessState(
				snapshot({ accessTokenExpiresAt: "2025-12-31T23:59:59Z" }),
				OPTIONS,
			),
		).toBe(TokenSetTokenFreshnessState.Expired);
		expect(getTokenFreshnessState(snapshot({}), OPTIONS)).toBe(
			TokenSetTokenFreshnessState.NoExpiry,
		);
		expect(
			getTokenFreshnessState(
				snapshot({ accessTokenExpiresAt: "not-a-date" }),
				OPTIONS,
			),
		).toBe(TokenSetTokenFreshnessState.NoExpiry);
	});

	it("projects bearer headers and identifies tokens requiring refresh", () => {
		const fresh = snapshot({ accessTokenExpiresAt: "2026-01-01T00:05:00Z" });
		const expired = snapshot({
			accessTokenExpiresAt: "2025-12-31T23:59:59Z",
			refreshMaterial: "rt",
		});

		expect(getTokenFreshnessState(fresh, OPTIONS)).toBe(
			TokenSetTokenFreshnessState.Fresh,
		);
		expect(tokenSetBearerHeader(fresh.tokens)).toBe("Bearer at");
		expect(getTokenFreshnessState(expired, OPTIONS)).toBe(
			TokenSetTokenFreshnessState.Expired,
		);
		expect(tokenSetBearerHeader(expired.tokens)).toBe("Bearer at");
	});

	it("keeps short-lived newly issued tokens fresh by capping skew and refresh window", () => {
		const shortLived = snapshot({
			accessTokenIssuedAt: "2026-01-01T00:00:00Z",
			accessTokenExpiresAt: "2026-01-01T00:01:00Z",
			refreshMaterial: "rt",
		});

		expect(getTokenFreshnessState(shortLived, OPTIONS)).toBe(
			TokenSetTokenFreshnessState.Fresh,
		);
		expect(
			getTokenFreshnessState(shortLived, {
				...OPTIONS,
				now: NOW + 30_000,
			}),
		).toBe(TokenSetTokenFreshnessState.RefreshDue);
		expect(
			getTokenFreshnessState(shortLived, {
				...OPTIONS,
				now: NOW + 50_000,
			}),
		).toBe(TokenSetTokenFreshnessState.Expired);
	});
});
