import { type TokenSetAngularClient } from "./contracts";
import { type ClientMeta } from "./token-set-auth.registry";

/**
 * A failing entry returned to `onUnauthenticated` when one or more clients
 * could not be verified as authenticated.
 */
export interface UnauthenticatedEntry {
	/** The unauthenticated token-set client. */
	readonly client: TokenSetAngularClient;
	/** The client key for this client. */
	readonly clientKey: string;
	/** Full client metadata (urlPatterns, callbackPath, requirementKind, providerFamily). */
	readonly meta: ClientMeta;
}
