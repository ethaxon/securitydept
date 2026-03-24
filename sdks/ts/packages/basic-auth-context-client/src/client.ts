import type {
	AuthGuardResult,
	BasicAuthContextClientConfig,
	BasicAuthZoneConfig,
	ResolvedBasicAuthZone,
} from "./types";
import { AuthGuardRedirectStatus, AuthGuardResultKind } from "./types";

const DEFAULT_LOGIN_SUBPATH = "/login";
const DEFAULT_LOGOUT_SUBPATH = "/logout";
const DEFAULT_POST_AUTH_REDIRECT_PARAM = "post_auth_redirect_uri";

function resolveZone(config: BasicAuthZoneConfig): ResolvedBasicAuthZone {
	const prefix = config.zonePrefix.replace(/\/+$/, "");
	const loginSub = config.loginSubpath ?? DEFAULT_LOGIN_SUBPATH;
	const logoutSub = config.logoutSubpath ?? DEFAULT_LOGOUT_SUBPATH;

	return {
		zonePrefix: prefix,
		loginPath: prefix + loginSub,
		logoutPath: prefix + logoutSub,
	};
}

/**
 * Basic Auth Context Client.
 *
 * Thin client that manages zone boundary awareness and redirect instructions.
 * It does NOT manage credentials or HTTP auth headers — those are handled
 * by the browser's native Basic Auth UI triggered by 401 + WWW-Authenticate.
 */
export class BasicAuthContextClient {
	readonly zones: readonly ResolvedBasicAuthZone[];
	private readonly _baseUrl: string;
	private readonly _postAuthRedirectParam: string;

	constructor(config: BasicAuthContextClientConfig) {
		this._baseUrl = config.baseUrl.replace(/\/+$/, "");
		this._postAuthRedirectParam =
			config.postAuthRedirectParam ?? DEFAULT_POST_AUTH_REDIRECT_PARAM;
		this.zones = config.zones.map(resolveZone);
	}

	/** Find the zone that contains the given path. */
	zoneForPath(path: string): ResolvedBasicAuthZone | undefined {
		return this.zones.find(
			(z) => path === z.zonePrefix || path.startsWith(`${z.zonePrefix}/`),
		);
	}

	/** Check whether a path falls inside any configured zone. */
	isInZone(path: string): boolean {
		return this.zoneForPath(path) !== undefined;
	}

	/** Build the full login URL for a zone, optionally with a post-auth redirect. */
	loginUrl(zone: ResolvedBasicAuthZone, postAuthRedirectUri?: string): string {
		const base = this._baseUrl + zone.loginPath;
		if (postAuthRedirectUri) {
			const params = new URLSearchParams({
				[this._postAuthRedirectParam]: postAuthRedirectUri,
			});
			return `${base}?${params.toString()}`;
		}
		return base;
	}

	/** Build the full logout URL for a zone. */
	logoutUrl(zone: ResolvedBasicAuthZone): string {
		return this._baseUrl + zone.logoutPath;
	}

	/**
	 * Handle a 401 response: if the current path is inside a zone,
	 * return a redirect instruction to the zone's login URL.
	 */
	handleUnauthorized(
		currentPath: string,
		responseStatus: number,
	): AuthGuardResult<null> {
		if (responseStatus !== 401) {
			return { kind: AuthGuardResultKind.Ok, value: null };
		}

		const zone = this.zoneForPath(currentPath);
		if (!zone) {
			return { kind: AuthGuardResultKind.Ok, value: null };
		}

		return {
			kind: AuthGuardResultKind.Redirect,
			status: AuthGuardRedirectStatus.Found,
			location: this.loginUrl(zone, currentPath),
		};
	}
}
