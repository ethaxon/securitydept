import type { TimeTrait } from "@securitydept/client";
import {
	getAccessTokenFreshnessTiming,
	TokenFreshnessState,
	type TokenFreshnessTiming,
} from "../../../token/freshness";
import type { AuthSnapshot } from "../../../token/types";
import {
	type AuthDeterminationCandidate,
	AuthDeterminationKind,
} from "../commit";

export type FetchRefreshedSnapshot = (
	snapshot: AuthSnapshot,
	freshness: TokenFreshnessTiming,
) => Promise<AuthSnapshot | null>;

export interface PlanRefreshFreshnessOptions {
	clockSkewMs: number;
	refreshWindowMs: number;
}

export interface PlanRefreshRequest {
	snapshot: AuthSnapshot;
	freshnessOptions: PlanRefreshFreshnessOptions;
	time: TimeTrait;
	fetchRefreshedSnapshot: FetchRefreshedSnapshot;
}

export type PlanRefreshResponse = AuthDeterminationCandidate & {
	freshness: TokenFreshnessTiming;
};

export async function planRefresh({
	snapshot,
	freshnessOptions,
	fetchRefreshedSnapshot,
	time,
}: PlanRefreshRequest): Promise<PlanRefreshResponse> {
	const now = time.now();
	const freshnessTiming = getAccessTokenFreshnessTiming(snapshot.tokens, now, {
		...freshnessOptions,
	});
	const freshnessState = freshnessTiming.state;

	if (
		freshnessState === TokenFreshnessState.Fresh ||
		freshnessState === TokenFreshnessState.NoExpiry
	) {
		return {
			kind: AuthDeterminationKind.Authenticated,
			snapshot,
			freshness: freshnessTiming,
		};
	}

	if (!snapshot.tokens.refreshMaterial) {
		return {
			kind: AuthDeterminationKind.Unauthenticated,
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
				kind: AuthDeterminationKind.Authenticated,
				snapshot: refreshedSnapshot,
				freshness: freshnessTiming,
			};
		}
		return {
			kind: AuthDeterminationKind.Unauthenticated,
			freshness: freshnessTiming,
		};
	} catch (error) {
		return {
			kind: AuthDeterminationKind.Failed,
			freshness: freshnessTiming,
			error,
		};
	}
}
