import {
	EventSourceKind,
	type RuntimeEventEnvelope,
} from "@securitydept/client";
import { type TokenFreshnessTiming } from "../token/freshness";

export const TokenSetAuthEventType = {
	AuthMaterialRestoreStarted: "auth.material.restore.started",
	AuthMaterialRestored: "auth.material.restored",
	AuthMaterialRestoreFailed: "auth.material.restore.failed",
	AuthRefreshRequired: "auth.refresh.required",
	AuthRefreshStarted: "auth.refresh.started",
	AuthRefreshSucceeded: "auth.refresh.succeeded",
	AuthRefreshFailed: "auth.refresh.failed",
	AuthMaterialCleared: "auth.material.cleared",
	AuthAuthenticated: "auth.authenticated",
	AuthUnauthenticated: "auth.unauthenticated",
} as const;

export type TokenSetAuthEventType =
	(typeof TokenSetAuthEventType)[keyof typeof TokenSetAuthEventType];

export interface TokenSetAuthErrorSummary {
	message?: string;
	errorKind?: string;
	errorCode?: string;
	recovery?: string;
}

// Minimal identity context every auth event may carry. Intentionally limited to
// stable, externally meaningful identifiers; do not re-accumulate weakly-typed
// global fields on this base.
export interface TokenSetAuthEventPayloadBase {
	id?: string;
}

// Refresh decision / lifecycle events are the only surface that projects token
// freshness timing and refresh-material presence. `freshness` originates from
// the refresh planner / refresh fetcher boundary and is never re-derived on the
// host, so it is always present on these events.
export interface TokenSetAuthRefreshEventPayload
	extends TokenSetAuthEventPayloadBase {
	freshness: TokenFreshnessTiming;
	hasRefreshMaterial: boolean;
}

type AuthMaterialRestoreStartedEvent = RuntimeEventEnvelope<
	typeof TokenSetAuthEventType.AuthMaterialRestoreStarted,
	TokenSetAuthEventPayloadBase & {
		persisted: true;
	}
>;

type AuthMaterialRestoredEvent = RuntimeEventEnvelope<
	typeof TokenSetAuthEventType.AuthMaterialRestored,
	TokenSetAuthEventPayloadBase & {
		persisted?: true;
	}
>;

type AuthMaterialRestoreFailedEvent = RuntimeEventEnvelope<
	typeof TokenSetAuthEventType.AuthMaterialRestoreFailed,
	TokenSetAuthEventPayloadBase & {
		persisted: true;
		errorSummary: TokenSetAuthErrorSummary;
	}
>;

type AuthRefreshRequiredEvent = RuntimeEventEnvelope<
	typeof TokenSetAuthEventType.AuthRefreshRequired,
	TokenSetAuthRefreshEventPayload
>;

type AuthRefreshStartedEvent = RuntimeEventEnvelope<
	typeof TokenSetAuthEventType.AuthRefreshStarted,
	TokenSetAuthRefreshEventPayload
>;

type AuthRefreshSucceededEvent = RuntimeEventEnvelope<
	typeof TokenSetAuthEventType.AuthRefreshSucceeded,
	TokenSetAuthRefreshEventPayload
>;

type AuthRefreshFailedEvent = RuntimeEventEnvelope<
	typeof TokenSetAuthEventType.AuthRefreshFailed,
	TokenSetAuthRefreshEventPayload & {
		errorSummary: TokenSetAuthErrorSummary;
	}
>;

type AuthMaterialClearedEvent = RuntimeEventEnvelope<
	typeof TokenSetAuthEventType.AuthMaterialCleared,
	TokenSetAuthEventPayloadBase
>;

type AuthAuthenticatedEvent = RuntimeEventEnvelope<
	typeof TokenSetAuthEventType.AuthAuthenticated,
	TokenSetAuthEventPayloadBase
>;

type AuthUnauthenticatedEvent = RuntimeEventEnvelope<
	typeof TokenSetAuthEventType.AuthUnauthenticated,
	TokenSetAuthEventPayloadBase
>;

type AnyTokenSetAuthEvent =
	| AuthMaterialRestoreStartedEvent
	| AuthMaterialRestoredEvent
	| AuthMaterialRestoreFailedEvent
	| AuthRefreshRequiredEvent
	| AuthRefreshStartedEvent
	| AuthRefreshSucceededEvent
	| AuthRefreshFailedEvent
	| AuthMaterialClearedEvent
	| AuthAuthenticatedEvent
	| AuthUnauthenticatedEvent;

export type TokenSetAuthEvent<
	TType extends TokenSetAuthEventType = TokenSetAuthEventType,
> = Extract<AnyTokenSetAuthEvent, { type: TType }>;

export type TokenSetAuthEventPayload<TType extends TokenSetAuthEventType> =
	TokenSetAuthEvent<TType>["payload"];

export interface CreateTokenSetAuthEventOptions<
	TType extends TokenSetAuthEventType,
> {
	id: string;
	type: TType;
	at: number;
	payload: TokenSetAuthEventPayload<TType>;
}

type AnyCreateTokenSetAuthEventOptions = {
	[K in TokenSetAuthEventType]: CreateTokenSetAuthEventOptions<K>;
}[TokenSetAuthEventType];

export function createTokenSetAuthEvent<TType extends TokenSetAuthEventType>(
	options: CreateTokenSetAuthEventOptions<TType>,
): TokenSetAuthEvent<TType>;
export function createTokenSetAuthEvent(
	options: AnyCreateTokenSetAuthEventOptions,
): AnyTokenSetAuthEvent {
	const source = {
		kind: EventSourceKind.System,
		subsystem: "token-set-auth",
	} as const;

	switch (options.type) {
		case TokenSetAuthEventType.AuthMaterialRestoreStarted:
			return {
				id: options.id,
				type: options.type,
				at: options.at,
				source,
				payload: options.payload,
			};
		case TokenSetAuthEventType.AuthMaterialRestored:
			return {
				id: options.id,
				type: options.type,
				at: options.at,
				source,
				payload: options.payload,
			};
		case TokenSetAuthEventType.AuthMaterialRestoreFailed:
			return {
				id: options.id,
				type: options.type,
				at: options.at,
				source,
				payload: options.payload,
			};
		case TokenSetAuthEventType.AuthRefreshRequired:
			return {
				id: options.id,
				type: options.type,
				at: options.at,
				source,
				payload: options.payload,
			};
		case TokenSetAuthEventType.AuthRefreshStarted:
			return {
				id: options.id,
				type: options.type,
				at: options.at,
				source,
				payload: options.payload,
			};
		case TokenSetAuthEventType.AuthRefreshSucceeded:
			return {
				id: options.id,
				type: options.type,
				at: options.at,
				source,
				payload: options.payload,
			};
		case TokenSetAuthEventType.AuthRefreshFailed:
			return {
				id: options.id,
				type: options.type,
				at: options.at,
				source,
				payload: options.payload,
			};
		case TokenSetAuthEventType.AuthMaterialCleared:
			return {
				id: options.id,
				type: options.type,
				at: options.at,
				source,
				payload: options.payload,
			};
		case TokenSetAuthEventType.AuthAuthenticated:
			return {
				id: options.id,
				type: options.type,
				at: options.at,
				source,
				payload: options.payload,
			};
		case TokenSetAuthEventType.AuthUnauthenticated:
			return {
				id: options.id,
				type: options.type,
				at: options.at,
				source,
				payload: options.payload,
			};
	}
}

export function summarizeAuthError(error: unknown): TokenSetAuthErrorSummary {
	if (error instanceof Error) {
		const record = error as Error &
			Partial<Record<"kind" | "code" | "recovery", unknown>>;
		return {
			message: error.message,
			errorKind: typeof record.kind === "string" ? record.kind : undefined,
			errorCode: typeof record.code === "string" ? record.code : undefined,
			recovery:
				typeof record.recovery === "string" ? record.recovery : undefined,
		};
	}
	if (typeof error === "object" && error !== null) {
		const record = error as Record<string, unknown>;
		return {
			message: typeof record.message === "string" ? record.message : undefined,
			errorKind: typeof record.kind === "string" ? record.kind : undefined,
			errorCode: typeof record.code === "string" ? record.code : undefined,
			recovery:
				typeof record.recovery === "string" ? record.recovery : undefined,
		};
	}
	return { message: String(error) };
}
