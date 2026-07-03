import {
	type CancellationTokenOptions,
	type ClientError,
	type IdentityPrincipal,
} from "@securitydept/client";

// --- Session Context Client types ---

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

export interface SessionContextOperationOptions
	extends CancellationTokenOptions {}

export interface SessionLoginWithRedirectOptions
	extends CancellationTokenOptions {
	postAuthRedirectUri?: string;
}

/** Configuration for the Session Context Client. */
export interface SessionContextClientConfig {
	id?: string;
	/** Base URL of the SecurityDept server. */
	baseUrl: string;
	/** Login path (default: "/auth/session/login"). */
	loginPath?: string;
	/** Logout path (default: "/auth/session/logout"). */
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

interface SessionContextEventBase {
	readonly at: number;
	readonly client: {
		readonly id: string;
	};
}

type SessionContextEventData =
	| {
			readonly type: typeof SessionContextEventType.SessionRefreshStarted;
			readonly session: SessionInfo | null;
	  }
	| {
			readonly type: typeof SessionContextEventType.SessionRefreshSucceeded;
			readonly session: SessionInfo | null;
	  }
	| {
			readonly type: typeof SessionContextEventType.SessionRefreshFailed;
			readonly session: SessionInfo | null;
			readonly error: ClientError;
	  }
	| {
			readonly type: typeof SessionContextEventType.SessionLogoutStarted;
			readonly session: SessionInfo | null;
	  }
	| {
			readonly type: typeof SessionContextEventType.SessionLogoutSucceeded;
			readonly session: null;
	  }
	| {
			readonly type: typeof SessionContextEventType.SessionLogoutFailed;
			readonly session: SessionInfo | null;
			readonly error: ClientError;
	  };

export type SessionContextEvent = SessionContextEventBase &
	SessionContextEventData;

export type SessionContextEventInput = SessionContextEventData;
