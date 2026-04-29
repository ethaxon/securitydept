import { describe, expect, it } from "vitest";
import {
	freshBearerHeader,
	getTokenFreshness,
	isAccessTokenUsable,
	shouldRefreshAccessToken,
	TokenFreshnessState,
} from "../token-ops";
import type { AuthSnapshot } from "../types";

const NOW = Date.parse("2026-01-01T00:00:00Z");
const OPTIONS = {
	now: NOW,
	clockSkewMs: 30_000,
	refreshWindowMs: 60_000,
};

function snapshot(options: Partial<AuthSnapshot["tokens"]>): AuthSnapshot {
	return {
		tokens: {
			accessToken: "at",
			...options,
		},
		metadata: {},
	};
}

describe("token freshness operations", () => {
	it("classifies fresh, refresh-due, expired, no-expiry, and invalid expiry tokens", () => {
		expect(
			getTokenFreshness(
				snapshot({ accessTokenExpiresAt: "2026-01-01T00:05:00Z" }),
				OPTIONS,
			),
		).toBe(TokenFreshnessState.Fresh);
		expect(
			getTokenFreshness(
				snapshot({ accessTokenExpiresAt: "2026-01-01T00:01:20Z" }),
				OPTIONS,
			),
		).toBe(TokenFreshnessState.RefreshDue);
		expect(
			getTokenFreshness(
				snapshot({ accessTokenExpiresAt: "2025-12-31T23:59:59Z" }),
				OPTIONS,
			),
		).toBe(TokenFreshnessState.Expired);
		expect(getTokenFreshness(snapshot({}), OPTIONS)).toBe(
			TokenFreshnessState.NoExpiry,
		);
		expect(
			getTokenFreshness(
				snapshot({ accessTokenExpiresAt: "not-a-date" }),
				OPTIONS,
			),
		).toBe(TokenFreshnessState.Expired);
	});

	it("projects only usable bearer headers", () => {
		const fresh = snapshot({ accessTokenExpiresAt: "2026-01-01T00:05:00Z" });
		const expired = snapshot({
			accessTokenExpiresAt: "2025-12-31T23:59:59Z",
			refreshMaterial: "rt",
		});

		expect(isAccessTokenUsable(fresh, OPTIONS)).toBe(true);
		expect(freshBearerHeader(fresh, OPTIONS)).toBe("Bearer at");
		expect(isAccessTokenUsable(expired, OPTIONS)).toBe(false);
		expect(freshBearerHeader(expired, OPTIONS)).toBeNull();
		expect(shouldRefreshAccessToken(expired, OPTIONS)).toBe(true);
	});

	it("keeps short-lived newly issued tokens fresh by capping skew and refresh window", () => {
		const shortLived = snapshot({
			accessTokenIssuedAt: "2026-01-01T00:00:00Z",
			accessTokenExpiresAt: "2026-01-01T00:01:00Z",
			refreshMaterial: "rt",
		});

		expect(getTokenFreshness(shortLived, OPTIONS)).toBe(
			TokenFreshnessState.Fresh,
		);
		expect(
			getTokenFreshness(shortLived, { ...OPTIONS, now: NOW + 30_000 }),
		).toBe(TokenFreshnessState.RefreshDue);
		expect(
			getTokenFreshness(shortLived, { ...OPTIONS, now: NOW + 50_000 }),
		).toBe(TokenFreshnessState.Expired);
	});
});
