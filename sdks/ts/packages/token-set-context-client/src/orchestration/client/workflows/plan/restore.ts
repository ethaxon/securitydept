import { type TimeTrait } from "@securitydept/client";
import { type AuthSnapshot } from "../../../token/types";
import {
	type AuthSnapshotPersistenceOptions,
	loadPersistedAuthSnapshot,
} from "../../persistence";
import {
	type AuthDeterminationAuthenticatedCandidate,
	type AuthDeterminationCandidate,
	AuthDeterminationKind,
} from "../commit";
import { type PlanRefreshFreshnessOptions } from "./refresh";

export interface PlanRestoreRequest {
	snapshot: AuthSnapshot;
}

export type PlanRestoreResponse = AuthDeterminationAuthenticatedCandidate;

export async function planRestore(
	request: PlanRestoreRequest,
): Promise<PlanRestoreResponse> {
	return {
		kind: AuthDeterminationKind.Authenticated,
		snapshot: request.snapshot,
	};
}

export interface PlanRestorePersistedRequest {
	persistence: AuthSnapshotPersistenceOptions;
	time: TimeTrait;
	freshnessOptions: PlanRefreshFreshnessOptions;
}

export type PlanRestorePersistedResponse = AuthDeterminationCandidate;

export async function planRestorePersisted(
	request: PlanRestorePersistedRequest,
): Promise<PlanRestorePersistedResponse> {
	try {
		const snapshot = await loadPersistedAuthSnapshot(request.persistence);
		if (snapshot) {
			return {
				kind: AuthDeterminationKind.Authenticated,
				snapshot,
			};
		}
		return {
			kind: AuthDeterminationKind.Unauthenticated,
		};
	} catch (error) {
		return {
			kind: AuthDeterminationKind.Failed,
			error,
		};
	}
}
