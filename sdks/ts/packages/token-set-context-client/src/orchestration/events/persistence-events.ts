import {
	EventSourceKind,
	type RuntimeEventEnvelope,
} from "@securitydept/client";
import { type TokenSetAuthErrorSummary } from "./auth-events";

export const TokenSetPersistenceEventType = {
	PersistenceSyncStarted: "persistence.sync.started",
	PersistenceSyncSkipped: "persistence.sync.skipped",
	PersistenceSyncSucceeded: "persistence.sync.succeeded",
	PersistenceSyncFailed: "persistence.sync.failed",
} as const;

export type TokenSetPersistenceEventType =
	(typeof TokenSetPersistenceEventType)[keyof typeof TokenSetPersistenceEventType];

export const TokenSetPersistenceAction = {
	Save: "save",
	Clear: "clear",
	Skip: "skip",
} as const;

export type TokenSetPersistenceAction =
	(typeof TokenSetPersistenceAction)[keyof typeof TokenSetPersistenceAction];

export const TokenSetPersistenceReason = {
	SkipPolicy: "skip_policy",
	NoPersistence: "no_persistence",
	RawUnchanged: "raw_unchanged",
	SerializationFailed: "serialization_failed",
	StoreFailed: "store_failed",
} as const;

export type TokenSetPersistenceReason =
	(typeof TokenSetPersistenceReason)[keyof typeof TokenSetPersistenceReason];

export interface TokenSetPersistenceEventPayload {
	id?: string;
	action: TokenSetPersistenceAction;
	reason?: TokenSetPersistenceReason;
	errorSummary?: TokenSetAuthErrorSummary;
}

export type TokenSetPersistenceEvent = RuntimeEventEnvelope<
	TokenSetPersistenceEventType,
	TokenSetPersistenceEventPayload
>;

export interface CreateTokenSetPersistenceEventOptions {
	id: string;
	type: TokenSetPersistenceEventType;
	at: number;
	payload: TokenSetPersistenceEventPayload;
}

export function createTokenSetPersistenceEvent(
	options: CreateTokenSetPersistenceEventOptions,
): TokenSetPersistenceEvent {
	return {
		id: options.id,
		type: options.type,
		at: options.at,
		source: {
			kind: EventSourceKind.System,
			subsystem: "token-set-persistence",
		},
		payload: options.payload,
	};
}
