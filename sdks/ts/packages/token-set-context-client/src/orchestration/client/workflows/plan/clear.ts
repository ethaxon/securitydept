import {
	AuthDeterminationKind,
	type AuthDeterminationUnauthenticatedCandidate,
} from "../commit";

// biome-ignore lint/complexity/noBannedTypes: This is a placeholder type for now, and may be expanded in the future if needed.
export type PlanClearRequest = {};

export type PlanClearResponse = AuthDeterminationUnauthenticatedCandidate;

export async function planClear(
	_request: PlanClearRequest,
): Promise<PlanClearResponse> {
	return {
		kind: AuthDeterminationKind.Unauthenticated,
	};
}
