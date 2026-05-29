import { type IdentityPrincipal } from "@securitydept/client";

// --- Session Context Client types ---

export const SessionContextSource = {
	SessionContext: "session-context",
} as const;

export type SessionContextSource =
	(typeof SessionContextSource)[keyof typeof SessionContextSource];

/** Session principal — shared authenticated principal semantics via @securitydept/client. */
export type SessionPrincipal = IdentityPrincipal;

/** Session info returned from the server. */
export interface SessionInfo {
	principal: SessionPrincipal;
	attributes?: Record<string, unknown>;
	extra?: Record<string, unknown>;
}

export interface SessionContextClientTracingOptions {
	target?: string;
	prefix?: string;
}

/** Configuration for the Session Context Client. */
export interface SessionContextClientConfig {
	id?: string;
	/** Base URL of the SecurityDept server. */
	baseUrl: string;
	/** Login path (default: "/login"). */
	loginPath?: string;
	/** Logout path (default: "/logout"). */
	logoutPath?: string;
	/** User info endpoint path (default: "/auth/session/user-info"). */
	userInfoPath?: string;
	autoStart?: boolean;
	tracing?: SessionContextClientTracingOptions;
}

export interface ResolvedSessionContextClientConfig {
	id: string;
	baseUrl: string;
	loginPath: string;
	logoutPath: string;
	userInfoPath: string;
	tracing: Required<SessionContextClientTracingOptions>;
}

export const SessionContextEventType = {
	SessionRefreshStarted: "session.refresh.started",
	SessionRefreshSucceeded: "session.refresh.succeeded",
	SessionRefreshFailed: "session.refresh.failed",
	SessionLogoutStarted: "session.logout.started",
	SessionLogoutSucceeded: "session.logout.succeeded",
	SessionLogoutFailed: "session.logout.failed",
} as const;

export type SessionContextEventType =
	(typeof SessionContextEventType)[keyof typeof SessionContextEventType];

export interface SessionContextEvent {
	type: SessionContextEventType;
	at: number;
	client: {
		id: string;
	};
	session?: SessionInfo | null;
	errorSummary?: Record<string, unknown>;
}
