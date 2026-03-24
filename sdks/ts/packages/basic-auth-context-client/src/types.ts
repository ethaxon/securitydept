// --- Basic Auth Context Client types ---

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
	/** Base URL of the SecurityDept server. */
	baseUrl: string;
	/** One or more Basic Auth zones to manage. */
	zones: BasicAuthZoneConfig[];
	/** Name of the query parameter for post-auth redirect (default: "post_auth_redirect_uri"). */
	postAuthRedirectParam?: string;
}

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
