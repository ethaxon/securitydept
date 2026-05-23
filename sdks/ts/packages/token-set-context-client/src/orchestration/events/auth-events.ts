import type { RuntimeEventEnvelope } from "@securitydept/client";
import { EventSourceKind } from "@securitydept/client";
import type { TokenFreshnessTiming } from "../token/freshness";
import type {
	TokenSetAuthFlowOutcome,
	TokenSetAuthFlowReason,
} from "../vocabulary/auth-flow";

export const TokenSetAuthEventType = {
	AuthMaterialRestoreStarted: "auth.material.restore.started",
	AuthMaterialRestored: "auth.material.restored",
	AuthMaterialRestoreFailed: "auth.material.restore.failed",
	AuthRefreshRequired: "auth.refresh.required",
	AuthRefreshSkipped: "auth.refresh.skipped",
	AuthRefreshStarted: "auth.refresh.started",
	AuthRefreshSucceeded: "auth.refresh.succeeded",
	AuthRefreshFailed: "auth.refresh.failed",
	AuthMaterialCleared: "auth.material.cleared",
	AuthAuthenticated: "auth.authenticated",
	AuthUnauthenticated: "auth.unauthenticated",
	AuthRedirectRequired: "auth.redirect.required",
	AuthCheckRequested: "auth.check.requested",
	AuthCheckSkipped: "auth.check.skipped",
	AuthCheckCompleted: "auth.check.completed",
	AuthCheckFailed: "auth.check.failed",
} as const;

export type TokenSetAuthEventType =
	(typeof TokenSetAuthEventType)[keyof typeof TokenSetAuthEventType];

export interface TokenSetAuthErrorSummary {
	message?: string;
	errorKind?: string;
	errorCode?: string;
	recovery?: string;
}

export interface TokenSetAuthEventPayload {
	clientKey?: string;
	logicalClientId?: string;
	requirementId?: string;
	requirementKind?: string;
	providerFamily?: string;
	url?: string;
	freshness?: TokenFreshnessTiming;
	hasRefreshMaterial?: boolean;
	outcome?: TokenSetAuthFlowOutcome;
	reason?: TokenSetAuthFlowReason;
	authCheckReason?: string;
	errorSummary?: TokenSetAuthErrorSummary;
	persisted?: boolean;
}

export type TokenSetAuthEvent = RuntimeEventEnvelope<
	TokenSetAuthEventType,
	TokenSetAuthEventPayload
>;

export interface CreateTokenSetAuthEventOptions {
	id: string;
	type: TokenSetAuthEventType;
	at: number;
	payload: TokenSetAuthEventPayload;
}

export function createTokenSetAuthEvent(
	options: CreateTokenSetAuthEventOptions,
): TokenSetAuthEvent {
	return {
		id: options.id,
		type: options.type,
		at: options.at,
		source: {
			kind: EventSourceKind.System,
			subsystem: "token-set-auth",
		},
		payload: options.payload,
	};
}

export function summarizeAuthError(error: unknown): TokenSetAuthErrorSummary {
	if (error instanceof Error) {
		return { message: error.message };
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
