import {
	type TokenSetAuthEventPayload,
	type TokenSetAuthEventType,
} from "../../events/auth-events";
import { type AuthSnapshot } from "../../token/types";

export const AuthDeterminationKind = {
	Authenticated: "authenticated",
	Unauthenticated: "unauthenticated",
	Failed: "failed",
} as const;

export type AuthDeterminationKind =
	(typeof AuthDeterminationKind)[keyof typeof AuthDeterminationKind];

export interface AuthDeterminationAuthenticatedCandidate {
	kind: typeof AuthDeterminationKind.Authenticated;
	snapshot: AuthSnapshot;
	error?: never;
}

export interface AuthDeterminationUnauthenticatedCandidate {
	kind: typeof AuthDeterminationKind.Unauthenticated;
	snapshot?: never;
	error?: never;
}

export interface AuthDeterminationFailedCandidate {
	kind: typeof AuthDeterminationKind.Failed;
	error: unknown;
	snapshot?: never;
}

export type AuthDeterminationCandidate =
	| AuthDeterminationAuthenticatedCandidate
	| AuthDeterminationUnauthenticatedCandidate
	| AuthDeterminationFailedCandidate;

export const PersistPolicy = {
	FollowClient: "follow_client",
	Skip: "skip",
} as const;

export type PersistPolicy = (typeof PersistPolicy)[keyof typeof PersistPolicy];

export type AuthDeterminationEvent = {
	[K in TokenSetAuthEventType]: {
		type: K;
		payload: TokenSetAuthEventPayload<K>;
	};
}[TokenSetAuthEventType];

export interface AuthDeterminationTrace {
	type: string;
	attributes?: Record<string, unknown>;
}

export interface AuthDeterminationCommit<TResult> {
	candidate: AuthDeterminationCandidate;
	persistPolicy: PersistPolicy;
	events?: readonly AuthDeterminationEvent[];
	result: TResult;
	trace?: AuthDeterminationTrace;
	traceError?: unknown;
}
