import { type SpanAttributes } from "@securitydept/client";
import {
	type TokenSetAuthEventPayloadInput,
	type TokenSetAuthEventType,
} from "../../events/auth-events";
import { type TokenSetAuthSnapshot } from "../../token/types";

export const TokenSetAuthDeterminationKind = {
	Authenticated: "authenticated",
	Unauthenticated: "unauthenticated",
	Failed: "failed",
} as const;

export type TokenSetAuthDeterminationKind =
	(typeof TokenSetAuthDeterminationKind)[keyof typeof TokenSetAuthDeterminationKind];

export interface TokenSetAuthDeterminationAuthenticatedCandidate {
	kind: typeof TokenSetAuthDeterminationKind.Authenticated;
	snapshot: TokenSetAuthSnapshot;
	error?: never;
}

export interface TokenSetAuthDeterminationUnauthenticatedCandidate {
	kind: typeof TokenSetAuthDeterminationKind.Unauthenticated;
	snapshot?: never;
	error?: never;
}

export interface TokenSetAuthDeterminationFailedCandidate {
	kind: typeof TokenSetAuthDeterminationKind.Failed;
	error: unknown;
	snapshot?: never;
}

export type TokenSetAuthDeterminationCandidate =
	| TokenSetAuthDeterminationAuthenticatedCandidate
	| TokenSetAuthDeterminationUnauthenticatedCandidate
	| TokenSetAuthDeterminationFailedCandidate;

export const PersistPolicy = {
	FollowClient: "follow_client",
	Skip: "skip",
} as const;

export type PersistPolicy = (typeof PersistPolicy)[keyof typeof PersistPolicy];

export type TokenSetAuthDeterminationEvent = {
	[K in TokenSetAuthEventType]: {
		type: K;
		payload: Omit<TokenSetAuthEventPayloadInput<K>, "type">;
	};
}[TokenSetAuthEventType];

export interface TokenSetAuthDeterminationTrace {
	type: string;
	attributes?: SpanAttributes;
}

export interface TokenSetAuthDeterminationCommit {
	candidate: TokenSetAuthDeterminationCandidate;
	failureValue?: TokenSetAuthSnapshot | null;
	persistPolicy: PersistPolicy;
	events?: readonly TokenSetAuthDeterminationEvent[];
	trace?: TokenSetAuthDeterminationTrace;
	traceError?: unknown;
}

export const TokenSetAuthDeterminationOutcomeKind = {
	Return: "return",
	Throw: "throw",
} as const;

export type TokenSetAuthDeterminationOutcomeKind =
	(typeof TokenSetAuthDeterminationOutcomeKind)[keyof typeof TokenSetAuthDeterminationOutcomeKind];

export type TokenSetAuthDeterminationOutcome<TResult> =
	| {
			kind: typeof TokenSetAuthDeterminationOutcomeKind.Return;
			value: TResult;
	  }
	| {
			kind: typeof TokenSetAuthDeterminationOutcomeKind.Throw;
			error: unknown;
	  };

export interface TokenSetAuthDeterminationTerminal<TResult> {
	commit: TokenSetAuthDeterminationCommit;
	outcome: TokenSetAuthDeterminationOutcome<TResult>;
}
