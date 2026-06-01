/** biome-ignore-all lint/complexity/noBannedTypes: enable for event payload builders */
import {
	EventSourceKind,
	type RuntimeEventEnvelope,
} from "@securitydept/client";
import { type TokenSetTokenFreshnessTiming } from "../token/freshness";

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

// Minimal client identity context carried by every auth event. Keep the
// identity namespaced so event-specific payload fields cannot collide with it.
export interface TokenSetAuthEventPayloadBase {
	client: {
		id: string;
	};
}

export type TokenSetAuthEventPayloadBuilder<
	TType extends TokenSetAuthEventType,
	TExtra extends Record<string, unknown> = {},
> = {
	type: TType;
} & TExtra &
	TokenSetAuthEventPayloadBase;

// Refresh decision / lifecycle events are the only surface that projects token
// freshness timing and refresh-material presence. `freshness` originates from
// the refresh planner / refresh fetcher boundary and is never re-derived on the
// host, so it is always present on these events.

export type TokenSetAuthRefreshEventPayload<
	TType extends TokenSetAuthEventType,
	TExtra extends Record<string, unknown> = {},
> = TokenSetAuthEventPayloadBuilder<
	TType,
	{
		freshness: TokenSetTokenFreshnessTiming;
		hasRefreshMaterial: boolean;
	} & TExtra
>;

type AuthMaterialRestoreStartedEventPayload = TokenSetAuthEventPayloadBuilder<
	typeof TokenSetAuthEventType.AuthMaterialRestoreStarted,
	{
		persisted: true;
	}
>;

type AuthMaterialRestoredEventPayload = TokenSetAuthEventPayloadBuilder<
	typeof TokenSetAuthEventType.AuthMaterialRestored,
	{
		persisted?: true;
	}
>;

type AuthMaterialRestoreFailedEventPayload = TokenSetAuthEventPayloadBuilder<
	typeof TokenSetAuthEventType.AuthMaterialRestoreFailed,
	{
		persisted: true;
		errorSummary: TokenSetAuthErrorSummary;
	}
>;

type AuthRefreshRequiredEventPayload = TokenSetAuthRefreshEventPayload<
	typeof TokenSetAuthEventType.AuthRefreshRequired
>;

type AuthRefreshStartedEventPayload = TokenSetAuthRefreshEventPayload<
	typeof TokenSetAuthEventType.AuthRefreshStarted
>;

type AuthRefreshSucceededEventPayload = TokenSetAuthRefreshEventPayload<
	typeof TokenSetAuthEventType.AuthRefreshSucceeded
>;

type AuthRefreshFailedEventPayload = TokenSetAuthRefreshEventPayload<
	typeof TokenSetAuthEventType.AuthRefreshFailed,
	{
		errorSummary: TokenSetAuthErrorSummary;
	}
>;

type AuthMaterialClearedEventPayload = TokenSetAuthEventPayloadBuilder<
	typeof TokenSetAuthEventType.AuthMaterialCleared
>;

type AuthAuthenticatedEventPayload = TokenSetAuthEventPayloadBuilder<
	typeof TokenSetAuthEventType.AuthAuthenticated
>;

type AuthUnauthenticatedEventPayload = TokenSetAuthEventPayloadBuilder<
	typeof TokenSetAuthEventType.AuthUnauthenticated
>;

export type TokenSetAuthEventPayload =
	| AuthMaterialRestoreStartedEventPayload
	| AuthMaterialRestoredEventPayload
	| AuthMaterialRestoreFailedEventPayload
	| AuthRefreshRequiredEventPayload
	| AuthRefreshStartedEventPayload
	| AuthRefreshSucceededEventPayload
	| AuthRefreshFailedEventPayload
	| AuthMaterialClearedEventPayload
	| AuthAuthenticatedEventPayload
	| AuthUnauthenticatedEventPayload;

export type TokenSetAuthEventPayloadInput<
	TType extends TokenSetAuthEventType = TokenSetAuthEventType,
> = {
	[K in TType]: Omit<Extract<TokenSetAuthEventPayload, { type: K }>, "client">;
}[TType];

export type TokenSetAuthEvent<
	TPayload extends TokenSetAuthEventPayload = TokenSetAuthEventPayload,
> = RuntimeEventEnvelope<TPayload["type"], TPayload>;

export interface CreateTokenSetAuthEventOptions<
	TPayload extends TokenSetAuthEventPayload,
> {
	id: string;
	type: TPayload["type"];
	at: number;
	payload: TPayload;
}

export function createTokenSetAuthEvent<
	TPayload extends TokenSetAuthEventPayload,
>(
	options: CreateTokenSetAuthEventOptions<TPayload>,
): TokenSetAuthEvent<TPayload> {
	const source = {
		kind: EventSourceKind.System,
		subsystem: "token-set-auth",
	} as const;

	return {
		id: options.id,
		type: options.type,
		at: options.at,
		source,
		payload: options.payload,
	};
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
