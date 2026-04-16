// React adapter contracts
//
// Mirrors the Angular adapter's `contracts.ts` so both framework adapters
// exchange the same duck-typed OIDC client surface when registering against
// the shared `TokenSetAuthRegistry` core.

import type { BackendOidcModeClient } from "@securitydept/token-set-context-client/backend-oidc-mode";
import type {
	ClientInitializationPriority,
	TokenSetClientEntry as CoreTokenSetClientEntry,
	OidcCallbackClient,
	OidcModeClient,
} from "@securitydept/token-set-context-client/registry";

// ============================================================================
// Client contracts
// ============================================================================

export type { OidcCallbackClient, OidcModeClient };

export type TokenSetBackendOidcClient = Pick<
	BackendOidcModeClient,
	"authorizeUrl" | "authorizationHeader" | "refresh" | "clearState"
> &
	OidcCallbackClient;

export type TokenSetReactClient = OidcModeClient & TokenSetBackendOidcClient;

// ============================================================================
// Multi-client registration
// ============================================================================

/**
 * React-side client entry. Pre-specialized to `TokenSetReactClient` so
 * adopters don't need to supply the type argument.
 */
export interface TokenSetClientEntry
	extends Omit<CoreTokenSetClientEntry<TokenSetReactClient>, "clientFactory"> {
	/**
	 * Factory returning the OIDC client. Supports sync / async.
	 */
	clientFactory: () => TokenSetReactClient | Promise<TokenSetReactClient>;
	/**
	 * Optional initialization priority (primary | lazy).
	 */
	priority?: ClientInitializationPriority;
}
