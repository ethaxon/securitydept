// React adapter contracts
//
// Mirrors the Angular adapter's `contracts.ts` so both framework adapters
// exchange the same concrete OIDC client surface when registering against
// the shared client registry core.

import {
	type DisposableTrait,
	type EventStreamTrait,
	type EventSubscriptionTrait,
	type ReadableReplaySignalTrait,
	type ReadableSignalTrait,
} from "@securitydept/client";
import { type BackendOidcModeClient } from "@securitydept/token-set-context-client/backend-oidc-mode";
import {
	type AuthSnapshot,
	type OidcPopupLoginOptions,
	type OidcPopupLoginResult,
	type OidcRedirectLoginOptions,
	type TokenSetAuthEvent,
	type TokenSetAuthOperationSignals,
	type TokenSetAuthWorkflowSource,
} from "@securitydept/token-set-context-client/orchestration";
import { type ClientInitializationMode } from "@securitydept/token-set-context-client/registry";

// ============================================================================
// Client contracts
// ============================================================================

export interface TokenSetReactClient extends DisposableTrait {
	authDetermined: ReadableReplaySignalTrait<true>;
	authSnapshot: ReadableReplaySignalTrait<AuthSnapshot | null>;
	isAuthenticated: ReadableReplaySignalTrait<boolean>;
	authorizationHeaderValue: ReadableReplaySignalTrait<string | undefined>;
	lastAuthError: ReadableSignalTrait<unknown | undefined>;
	authOperations: TokenSetAuthOperationSignals;
	authEvents: EventStreamTrait<TokenSetAuthEvent>;
	start(): Promise<unknown>;
	addWorkflowSource(source: TokenSetAuthWorkflowSource): EventSubscriptionTrait;
	removeWorkflowSource(source: TokenSetAuthWorkflowSource): boolean;
	dispose(): void;
	restorePersistedState(): Promise<unknown>;
	loginWithRedirect(options?: OidcRedirectLoginOptions): Promise<void>;
	loginWithPopup(options: OidcPopupLoginOptions): Promise<OidcPopupLoginResult>;
}

export type TokenSetBackendOidcClient = TokenSetReactClient &
	Pick<BackendOidcModeClient, "authorizeUrl" | "refreshState" | "clearState">;

// ============================================================================
// Multi-client registration
// ============================================================================

/**
 * React-side client entry. Pre-specialized to `TokenSetReactClient` so
 * adopters don't need to supply the type argument.
 */
export interface TokenSetClientEntry {
	/**
	 * Client registry key.
	 */
	key: string;
	/**
	 * Factory returning the OIDC client. Supports sync / async.
	 */
	clientFactory: () => TokenSetReactClient | Promise<TokenSetReactClient>;
	/**
	 * Optional initialization mode.
	 */
	initialization?: ClientInitializationMode;
	urlPatterns?: ReadonlyArray<string | RegExp | ((url: string) => boolean)>;
	callbackPath?: string;
	requirementKind?: string;
	providerFamily?: string;
}
