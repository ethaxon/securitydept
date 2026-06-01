import {
	AuthDeterminationKind,
	type AuthDeterminationUnauthenticatedCandidate,
} from "../commit";

export type PlanClearRequest = {};

export type PlanClearResponse = AuthDeterminationUnauthenticatedCandidate;

export async function planClear(
	_request: PlanClearRequest,
): Promise<PlanClearResponse> {
	return {
		kind: AuthDeterminationKind.Unauthenticated,
	};
}
