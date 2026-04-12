import type { TokenSetAuthService } from "./token-set-auth.service";
import type { ClientMeta } from "./token-set-auth-registry";

/**
 * A failing entry returned to `onUnauthenticated` when one or more clients
 * could not be verified as authenticated.
 */
export interface UnauthenticatedEntry {
	/** The unauthenticated `TokenSetAuthService`. */
	readonly service: TokenSetAuthService;
	/** The client key for this service. */
	readonly clientKey: string;
	/** Full client metadata (urlPatterns, callbackPath, requirementKind, providerFamily). */
	readonly meta: ClientMeta;
}
