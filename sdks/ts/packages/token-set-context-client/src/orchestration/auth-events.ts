import type { EventSource, RuntimeEventEnvelope } from "@securitydept/client";
import { EventSourceKind } from "@securitydept/client";
import type { TokenHandleDescriptor } from "./token-handle-store";
import type { TokenFreshnessState } from "./token-ops";

export const TokenSetAuthEventType = {
	AuthResourceRequested: "auth.resource.requested",
	AuthMaterialRestoreStarted: "auth.material.restore.started",
	AuthMaterialRestored: "auth.material.restored",
	AuthMaterialRestoreFailed: "auth.material.restore.failed",
	AuthRefreshRequired: "auth.refresh.required",
	AuthRefreshSkipped: "auth.refresh.skipped",
	AuthRefreshJoined: "auth.refresh.joined",
	AuthRefreshStarted: "auth.refresh.started",
	AuthRefreshSucceeded: "auth.refresh.succeeded",
	AuthRefreshFailed: "auth.refresh.failed",
	AuthMaterialCleared: "auth.material.cleared",
	AuthAuthenticated: "auth.authenticated",
	AuthUnauthenticated: "auth.unauthenticated",
	AuthorizationHeaderRequested: "auth.authorization_header.requested",
	AuthorizationHeaderResolved: "auth.authorization_header.resolved",
	AuthorizationHeaderUnavailable: "auth.authorization_header.unavailable",
	AuthRedirectRequired: "auth.redirect.required",
	ResumeReconcileRequested: "auth.resume_reconcile.requested",
	ResumeReconcileSkipped: "auth.resume_reconcile.skipped",
	ResumeReconcileCompleted: "auth.resume_reconcile.completed",
	ResumeReconcileFailed: "auth.resume_reconcile.failed",
} as const;

export type TokenSetAuthEventType =
	(typeof TokenSetAuthEventType)[keyof typeof TokenSetAuthEventType];

export const TokenSetAuthFlowSource = {
	Restore: "restore",
	Resume: "resume",
	RouteGuard: "route_guard",
	HttpInterceptor: "http_interceptor",
	AuthorizedTransport: "authorized_transport",
	ReactQuery: "react_query",
	TanStackBeforeLoad: "tanstack_before_load",
	RawWebRouter: "raw_web_router",
	ExplicitCall: "explicit_call",
	Timer: "timer",
	Callback: "callback",
	Manual: "manual",
} as const;

export type TokenSetAuthFlowSource =
	(typeof TokenSetAuthFlowSource)[keyof typeof TokenSetAuthFlowSource];

export const TokenSetAuthFlowOutcome = {
	Authenticated: "authenticated",
	Unauthenticated: "unauthenticated",
	HeaderResolved: "authorization_header_resolved",
	HeaderUnavailable: "authorization_header_unavailable",
	Skipped: "skipped",
	Failed: "failed",
} as const;

export type TokenSetAuthFlowOutcome =
	(typeof TokenSetAuthFlowOutcome)[keyof typeof TokenSetAuthFlowOutcome];

export const TokenSetAuthFlowReason = {
	NoSnapshot: "no_snapshot",
	Fresh: "fresh",
	NoExpiry: "no_expiry",
	RefreshDue: "refresh_due",
	Expired: "expired",
	NoRefreshMaterial: "no_refresh_material",
	BackgroundRefresh: "background_refresh",
	RefreshBarrierJoined: "refresh_barrier_joined",
	RefreshSucceeded: "refresh_succeeded",
	RefreshFailed: "refresh_failed",
	Cleared: "cleared",
	Disposed: "disposed",
} as const;

export type TokenSetAuthFlowReason =
	(typeof TokenSetAuthFlowReason)[keyof typeof TokenSetAuthFlowReason];

export interface TokenSetAuthErrorSummary {
	message?: string;
	errorKind?: string;
	errorCode?: string;
	recovery?: string;
}

export interface TokenSetAuthEventPayload {
	clientKey?: string;
	logicalClientId?: string;
	source: TokenSetAuthFlowSource;
	requirementId?: string;
	requirementKind?: string;
	providerFamily?: string;
	url?: string;
	freshness?: TokenFreshnessState;
	hasRefreshMaterial?: boolean;
	outcome?: TokenSetAuthFlowOutcome;
	reason?: TokenSetAuthFlowReason;
	errorSummary?: TokenSetAuthErrorSummary;
	persisted?: boolean;
	tokenHandle?: TokenHandleDescriptor;
	refreshBarrierId?: string;
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
		source: eventSourceForAuthFlow(options.payload.source),
		payload: options.payload,
	};
}

export function eventSourceForAuthFlow(
	source: TokenSetAuthFlowSource,
): EventSource {
	switch (source) {
		case TokenSetAuthFlowSource.Timer:
			return { kind: EventSourceKind.Timer, timer: "token-set-auth" };
		case TokenSetAuthFlowSource.HttpInterceptor:
		case TokenSetAuthFlowSource.AuthorizedTransport:
		case TokenSetAuthFlowSource.ReactQuery:
			return { kind: EventSourceKind.Http, requestId: source };
		case TokenSetAuthFlowSource.RouteGuard:
		case TokenSetAuthFlowSource.TanStackBeforeLoad:
		case TokenSetAuthFlowSource.RawWebRouter:
			return { kind: EventSourceKind.Framework, name: source };
		case TokenSetAuthFlowSource.Restore:
			return { kind: EventSourceKind.Storage, operation: "restore" };
		case TokenSetAuthFlowSource.Manual:
		case TokenSetAuthFlowSource.Callback:
			return { kind: EventSourceKind.User, actor: source };
		default:
			return { kind: EventSourceKind.System, subsystem: source };
	}
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
