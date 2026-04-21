import type { AuthenticatedPrincipal } from "@securitydept/client";

// --- Session Context Client types ---

export const SessionContextSource = {
	SessionContext: "session-context",
} as const;

export type SessionContextSource =
	(typeof SessionContextSource)[keyof typeof SessionContextSource];

/** Session principal — shared authenticated principal semantics via @securitydept/client. */
export type SessionPrincipal = AuthenticatedPrincipal;

/** Session info returned from the server. */
export interface SessionInfo {
	principal: SessionPrincipal;
	attributes?: Record<string, unknown>;
	extra?: Record<string, unknown>;
}

/** Configuration for the Session Context Client. */
export interface SessionContextClientConfig {
	/** Base URL of the SecurityDept server. */
	baseUrl: string;
	/** Login path (default: "/login"). */
	loginPath?: string;
	/** Logout path (default: "/logout"). */
	logoutPath?: string;
	/** User info endpoint path (default: "/auth/session/user-info"). */
	userInfoPath?: string;
	/** Name of the query parameter for post-auth redirect (default: "post_auth_redirect_uri"). */
	postAuthRedirectParam?: string;
	/** Optional key used with `runtime.sessionStore` for pending login redirect state. */
	loginRedirectStateKey?: string;
}
