import {
	TokenSetAuthDeterminationKind,
	type TokenSetAuthDeterminationUnauthenticatedCandidate,
} from "../commit";

export type TokenSetPlanClearRequest = {};

export type TokenSetPlanClearResponse =
	TokenSetAuthDeterminationUnauthenticatedCandidate;

export async function planClear(
	_request: TokenSetPlanClearRequest,
): Promise<TokenSetPlanClearResponse> {
	return {
		kind: TokenSetAuthDeterminationKind.Unauthenticated,
	};
}
