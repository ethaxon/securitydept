import { type TimeTrait } from "@securitydept/client";
import {
	getTokenSetAccessTokenFreshnessTiming,
	TokenSetTokenFreshnessState,
	type TokenSetTokenFreshnessTiming,
} from "../../../token/freshness";
import { type TokenSetAuthSnapshot } from "../../../token/types";
import {
	type TokenSetAuthDeterminationCandidate,
	TokenSetAuthDeterminationKind,
} from "../commit";

export type TokenSetFetchRefreshedSnapshot = (
	snapshot: TokenSetAuthSnapshot,
	freshness: TokenSetTokenFreshnessTiming,
) => Promise<TokenSetAuthSnapshot | null>;

export interface TokenSetPlanRefreshFreshnessOptions {
	clockSkewMs: number;
	refreshWindowMs: number;
}

export interface TokenSetPlanRefreshRequest {
	snapshot: TokenSetAuthSnapshot;
	freshnessOptions: TokenSetPlanRefreshFreshnessOptions;
	time: TimeTrait;
	fetchRefreshedSnapshot: TokenSetFetchRefreshedSnapshot;
}

export type TokenSetPlanRefreshResponse = TokenSetAuthDeterminationCandidate & {
	freshness: TokenSetTokenFreshnessTiming;
};

export async function planRefresh({
	snapshot,
	freshnessOptions,
	fetchRefreshedSnapshot,
	time,
}: TokenSetPlanRefreshRequest): Promise<TokenSetPlanRefreshResponse> {
	const now = time.now();
	const freshnessTiming = getTokenSetAccessTokenFreshnessTiming(
		snapshot.tokens,
		now,
		{
			...freshnessOptions,
		},
	);
	const freshnessState = freshnessTiming.state;

	if (
		freshnessState === TokenSetTokenFreshnessState.Fresh ||
		freshnessState === TokenSetTokenFreshnessState.NoExpiry
	) {
		return {
			kind: TokenSetAuthDeterminationKind.Authenticated,
			snapshot,
			freshness: freshnessTiming,
		};
	}

	if (!snapshot.tokens.refreshMaterial) {
		return {
			kind: TokenSetAuthDeterminationKind.Unauthenticated,
			freshness: freshnessTiming,
		};
	}

	try {
		const refreshedSnapshot = await fetchRefreshedSnapshot(
			snapshot,
			freshnessTiming,
		);
		if (refreshedSnapshot) {
			return {
				kind: TokenSetAuthDeterminationKind.Authenticated,
				snapshot: refreshedSnapshot,
				freshness: freshnessTiming,
			};
		}
		return {
			kind: TokenSetAuthDeterminationKind.Unauthenticated,
			freshness: freshnessTiming,
		};
	} catch (error) {
		return {
			kind: TokenSetAuthDeterminationKind.Failed,
			freshness: freshnessTiming,
			error,
		};
	}
}
