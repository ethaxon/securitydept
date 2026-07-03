// --- Basic Auth Context Client types ---

import {
	type CancellationTokenOptions,
	type ClientError,
	type ReadableSignalTrait,
	type ResourceSnapshot,
	type ResourceTrait,
} from "@securitydept/client";

export interface BasicAuthZoneConfig {
	/** URL path prefix for this zone (e.g. "/basic"). */
	zonePrefix: string;
	/** Login subpath relative to zone prefix (default: "/login"). */
	loginSubpath?: string;
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
} as const;

export type BasicAuthBoundaryKind =
	(typeof BasicAuthBoundaryKind)[keyof typeof BasicAuthBoundaryKind];

export interface BasicAuthBoundaryObservation {
	status: number;
	challengeHeader?: string | null;
	requestPath?: string;
}

export interface BasicAuthBoundarySnapshot {
	authenticated: boolean;
	boundaryKind: BasicAuthBoundaryKind;
	status: number;
	path: string;
	challengeHeader: string | null;
	zone?: ResolvedBasicAuthZone;
}

export const BasicAuthContextEventType = {
	BoundaryRefreshStarted: "basic_auth.boundary.refresh.started",
	BoundaryRefreshSucceeded: "basic_auth.boundary.refresh.succeeded",
	BoundaryRefreshFailed: "basic_auth.boundary.refresh.failed",
	/** These logout events describe local boundary-projection clearing only. */
	LogoutStarted: "basic_auth.logout.started",
	LogoutSucceeded: "basic_auth.logout.succeeded",
	LogoutFailed: "basic_auth.logout.failed",
	LoginRedirectStarted: "basic_auth.login.redirect.started",
	LoginRedirectSucceeded: "basic_auth.login.redirect.succeeded",
	LoginRedirectFailed: "basic_auth.login.redirect.failed",
} as const;

export type BasicAuthContextEventType =
	(typeof BasicAuthContextEventType)[keyof typeof BasicAuthContextEventType];

interface BasicAuthContextEventBase {
	readonly at: number;
	readonly client: {
		readonly id: string;
	};
}

type BasicAuthContextEventData =
	| {
			readonly type: typeof BasicAuthContextEventType.BoundaryRefreshStarted;
			readonly snapshot: BasicAuthBoundarySnapshot | null;
	  }
	| {
			readonly type: typeof BasicAuthContextEventType.BoundaryRefreshSucceeded;
			readonly snapshot: BasicAuthBoundarySnapshot;
			readonly zone?: ResolvedBasicAuthZone;
	  }
	| {
			readonly type: typeof BasicAuthContextEventType.BoundaryRefreshFailed;
			readonly snapshot: BasicAuthBoundarySnapshot | null;
			readonly error: ClientError;
	  }
	| {
			readonly type: typeof BasicAuthContextEventType.LogoutStarted;
			readonly snapshot: BasicAuthBoundarySnapshot | null;
	  }
	| {
			readonly type: typeof BasicAuthContextEventType.LogoutSucceeded;
			readonly snapshot: null;
	  }
	| {
			readonly type: typeof BasicAuthContextEventType.LogoutFailed;
			readonly snapshot: BasicAuthBoundarySnapshot | null;
			readonly error: ClientError;
	  }
	| {
			readonly type:
				| typeof BasicAuthContextEventType.LoginRedirectStarted
				| typeof BasicAuthContextEventType.LoginRedirectSucceeded;
			readonly zone: ResolvedBasicAuthZone;
	  }
	| {
			readonly type: typeof BasicAuthContextEventType.LoginRedirectFailed;
			readonly zone: ResolvedBasicAuthZone;
			readonly error: ClientError;
	  };

export type BasicAuthContextEvent = BasicAuthContextEventBase &
	BasicAuthContextEventData;

export type BasicAuthContextEventInput = BasicAuthContextEventData;

export interface BasicAuthContextOperationSignals {
	readonly startPending: ReadableSignalTrait<boolean>;
	readonly refreshPending: ReadableSignalTrait<boolean>;
	readonly logoutPending: ReadableSignalTrait<boolean>;
	readonly loginRedirectPending: ReadableSignalTrait<boolean>;
}

export interface BasicAuthRefreshOptions extends CancellationTokenOptions {
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

/** Options for clearing the client's in-memory boundary projection. */
export interface BasicAuthLogoutOptions extends CancellationTokenOptions {}

export type BasicAuthLoginWithRedirectOptions = BasicAuthZoneSelectionOptions &
	CancellationTokenOptions & {
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
}

export interface BasicAuthContextClientStateSignals {
	readonly boundarySnapshot: ReadableSignalTrait<
		ResourceSnapshot<BasicAuthBoundarySnapshot | null>
	>;
	readonly boundaryResource: ResourceTrait<BasicAuthBoundarySnapshot | null>;
	readonly isAuthenticated: ResourceTrait<boolean>;
}
