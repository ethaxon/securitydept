// --- Basic Auth Context Client types ---

import {
	type ReadableReplaySignalTrait,
	type ReadableSignalTrait,
} from "@securitydept/client";

/** Configuration for a single Basic Auth zone. */
export interface BasicAuthZoneConfig {
	/** URL path prefix for this zone (e.g. "/basic"). */
	zonePrefix: string;
	/** Login subpath relative to zone prefix (default: "/login"). */
	loginSubpath?: string;
	/** Logout subpath relative to zone prefix (default: "/logout"). */
	logoutSubpath?: string;
}

/** Configuration for the Basic Auth Context Client. */
export interface BasicAuthContextClientConfig {
	id?: string;
	/** Base URL of the SecurityDept server. */
	baseUrl: string;
	/** One or more Basic Auth zones to manage. */
	zones: BasicAuthZoneConfig[];
	/** Protected endpoint used by start()/refresh() to observe the boundary. */
	probePath?: string;
	autoStart?: boolean;
	tracing?: BasicAuthContextClientTracingOptions;
}

export interface BasicAuthContextClientTracingOptions {
	target?: string;
	prefix?: string;
}

export interface ResolvedBasicAuthContextClientConfig {
	id: string;
	baseUrl: string;
	zones: readonly ResolvedBasicAuthZone[];
	probePath?: string;
	tracing: Required<BasicAuthContextClientTracingOptions>;
}

export const BasicAuthBoundaryKind = {
	Authenticated: "authenticated",
	Challenge: "challenge",
	Unauthorized: "unauthorized",
	LogoutPoison: "logout_poison",
} as const;

export type BasicAuthBoundaryKind =
	(typeof BasicAuthBoundaryKind)[keyof typeof BasicAuthBoundaryKind];

export interface BasicAuthBoundaryObservation {
	status: number;
	challengeHeader?: string | null;
	requestPath?: string;
	isLogoutPath?: boolean;
}

export interface BasicAuthBoundarySnapshot {
	authenticated: boolean;
	boundaryKind: BasicAuthBoundaryKind;
	status: number;
	path: string;
	challengeHeader: string | null;
	zone?: ResolvedBasicAuthZone;
}

export const BasicAuthContextSource = {
	BasicAuthContext: "basic-auth-context",
} as const;

export type BasicAuthContextSource =
	(typeof BasicAuthContextSource)[keyof typeof BasicAuthContextSource];

export const BasicAuthContextEventType = {
	BoundaryRefreshStarted: "basic_auth.boundary.refresh.started",
	BoundaryRefreshSucceeded: "basic_auth.boundary.refresh.succeeded",
	BoundaryRefreshFailed: "basic_auth.boundary.refresh.failed",
	LogoutStarted: "basic_auth.logout.started",
	LogoutSucceeded: "basic_auth.logout.succeeded",
	LogoutFailed: "basic_auth.logout.failed",
	LoginRedirectStarted: "basic_auth.login.redirect.started",
	LoginRedirectSucceeded: "basic_auth.login.redirect.succeeded",
	LoginRedirectFailed: "basic_auth.login.redirect.failed",
} as const;

export type BasicAuthContextEventType =
	(typeof BasicAuthContextEventType)[keyof typeof BasicAuthContextEventType];

export interface BasicAuthContextEvent {
	type: BasicAuthContextEventType;
	at: number;
	client: {
		id: string;
	};
	snapshot?: BasicAuthBoundarySnapshot | null;
	zone?: ResolvedBasicAuthZone;
	errorSummary?: Record<string, unknown>;
}

export interface BasicAuthContextOperationSignals {
	readonly startPending: ReadableSignalTrait<boolean>;
	readonly refreshPending: ReadableSignalTrait<boolean>;
	readonly logoutPending: ReadableSignalTrait<boolean>;
	readonly loginRedirectPending: ReadableSignalTrait<boolean>;
}

export interface BasicAuthRefreshOptions {
	path?: string;
}

export type BasicAuthZoneSelectionOptions =
	| {
			currentPath: string;
			zonePrefix?: never;
	  }
	| {
			zonePrefix: string;
			currentPath?: never;
	  };

export type BasicAuthLogoutOptions = BasicAuthZoneSelectionOptions;

export type BasicAuthLoginWithRedirectOptions =
	BasicAuthZoneSelectionOptions & {
		postAuthRedirectUri?: string;
	};

export const AuthGuardResultKind = {
	Ok: "ok",
	Redirect: "redirect",
} as const;

export type AuthGuardResultKind =
	(typeof AuthGuardResultKind)[keyof typeof AuthGuardResultKind];

export const AuthGuardRedirectStatus = {
	Found: 302,
	SeeOther: 303,
	TemporaryRedirect: 307,
} as const;

export type AuthGuardRedirectStatus =
	(typeof AuthGuardRedirectStatus)[keyof typeof AuthGuardRedirectStatus];

/** Redirect instruction — framework-neutral result. */
export type AuthGuardResult<T> =
	| { kind: typeof AuthGuardResultKind.Ok; value: T }
	| {
			kind: typeof AuthGuardResultKind.Redirect;
			status: AuthGuardRedirectStatus;
			location: string;
	  };

/** Resolved zone with computed paths. */
export interface ResolvedBasicAuthZone {
	zonePrefix: string;
	loginPath: string;
	logoutPath: string;
}

export interface BasicAuthContextClientStateSignals {
	readonly boundarySnapshot: ReadableReplaySignalTrait<BasicAuthBoundarySnapshot | null>;
	readonly boundaryDetermined: ReadableReplaySignalTrait<true>;
	readonly isAuthenticated: ReadableReplaySignalTrait<boolean>;
}
