// React adapter contracts
//
// Mirrors the Angular adapter's `contracts.ts` so both framework adapters
// exchange the same duck-typed OIDC client surface when registering against
// the shared `TokenSetAuthRegistry` core.

import type { ReadableSignalTrait } from "@securitydept/client";
import type { AuthSnapshot } from "@securitydept/token-set-context-client/orchestration";
import type {
	ClientInitializationPriority,
	TokenSetClientEntry as CoreTokenSetClientEntry,
} from "@securitydept/token-set-context-client/registry";

// ============================================================================
// Client contracts
// ============================================================================

export interface OidcModeClient {
	state: ReadableSignalTrait<AuthSnapshot | null>;
	dispose(): void;
	restorePersistedState(): Promise<AuthSnapshot | null>;
}

export interface OidcCallbackClient {
	handleCallback(callbackUrl: string): Promise<{
		snapshot: AuthSnapshot;
		postAuthRedirectUri?: string;
	}>;
}

export type ReactClient = OidcModeClient & OidcCallbackClient;

// ============================================================================
// Multi-client registration
// ============================================================================

/**
 * React-side client entry. Pre-specialized to `ReactClient` so adopters
 * don't need to supply the type argument.
 */
export interface TokenSetClientEntry
	extends Omit<CoreTokenSetClientEntry<ReactClient>, "clientFactory"> {
	/**
	 * Factory returning the OIDC client. Supports sync / async.
	 */
	clientFactory: () => ReactClient | Promise<ReactClient>;
	/**
	 * Optional initialization priority (primary | lazy).
	 */
	priority?: ClientInitializationPriority;
}
