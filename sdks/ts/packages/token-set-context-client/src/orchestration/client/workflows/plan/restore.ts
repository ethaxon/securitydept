import { type TimeTrait } from "@securitydept/client";
import { type TokenSetAuthSnapshot } from "../../../token/types";
import {
	loadPersistedAuthSnapshot,
	type TokenSetAuthSnapshotPersistenceOptions,
} from "../../persistence";
import {
	type TokenSetAuthDeterminationAuthenticatedCandidate,
	type TokenSetAuthDeterminationCandidate,
	TokenSetAuthDeterminationKind,
} from "../commit";
import { type TokenSetPlanRefreshFreshnessOptions } from "./refresh";

export interface TokenSetPlanRestoreRequest {
	snapshot: TokenSetAuthSnapshot;
}

export type TokenSetPlanRestoreResponse =
	TokenSetAuthDeterminationAuthenticatedCandidate;

export async function planRestore(
	request: TokenSetPlanRestoreRequest,
): Promise<TokenSetPlanRestoreResponse> {
	return {
		kind: TokenSetAuthDeterminationKind.Authenticated,
		snapshot: request.snapshot,
	};
}

export interface TokenSetPlanRestorePersistedRequest {
	persistence: TokenSetAuthSnapshotPersistenceOptions;
	time: TimeTrait;
	freshnessOptions: TokenSetPlanRefreshFreshnessOptions;
}

export type TokenSetPlanRestorePersistedResponse =
	TokenSetAuthDeterminationCandidate;

export async function planRestorePersisted(
	request: TokenSetPlanRestorePersistedRequest,
): Promise<TokenSetPlanRestorePersistedResponse> {
	try {
		const snapshot = await loadPersistedAuthSnapshot(request.persistence);
		if (snapshot) {
			return {
				kind: TokenSetAuthDeterminationKind.Authenticated,
				snapshot,
			};
		}
		return {
			kind: TokenSetAuthDeterminationKind.Unauthenticated,
		};
	} catch (error) {
		return {
			kind: TokenSetAuthDeterminationKind.Failed,
			error,
		};
	}
}
