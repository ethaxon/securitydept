import {
	type DisposableTrait,
	type EventStreamTrait,
	type EventSubscriptionTrait,
	type ReadableReplaySignalTrait,
	type ReadableSignalTrait,
} from "@securitydept/client";
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
// 2. Client contracts
// ============================================================================

export interface TokenSetAngularClient extends DisposableTrait {
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

// ============================================================================
// 3. Multi-client registration
// ============================================================================

/**
 * A registration entry for a single token-set auth client.
 *
 * Each client is identified by a unique string key (e.g. "main", "admin",
 * the provider ID, or the requirement kind), so that routes, interceptors,
 * and callbacks can discriminate between multiple concurrent auth sources.
 *
 * ## Sync vs Async client factory
 *
 * `clientFactory` supports both synchronous and asynchronous materialization:
 *
 * - **Sync** (`() => TokenSetAngularClient`): The client config is available
 *   at registration time. Classic inline config or pre-resolved projections.
 *
 * - **Async** (`() => Promise<TokenSetAngularClient>`): The client config must
 *   be resolved asynchronously (e.g. fetched from a backend config projection
 *   endpoint). The registry tracks lifecycle state and provides
 *   `initialize()` for guards/interceptors that need to wait.
 *
 * When `clientFactory` returns a Promise, the registry marks this key as
 * initializing and transitions to ready or failed when the promise settles.
 *
 * Two additional discrimination axes are supported:
 *   - `requirementKind`: maps a RequirementKind (or custom string) → this client.
 *     Guards and resolvers can look up the client for a pending requirement without
 *     knowing the concrete key.
 *   - `providerFamily`: maps a named provider family (e.g. "google", "internal-sso")
 *     → this client. Useful when multiple clients share the same kind but differ
 *     by provider / audience.
 */
export interface TokenSetClientEntry {
	/**
	 * Client registry key.
	 */
	key: string;
	/**
	 * Factory that creates the OIDC mode client.
	 *
	 * May return the client synchronously (inline config) or a Promise
	 * (async config projection resolution). When a Promise is returned,
	 * the registry tracks initialization readiness automatically.
	 */
	clientFactory: () => TokenSetAngularClient | Promise<TokenSetAngularClient>;
	/**
	 * Initialization mode. Defaults to `"immediate"`. Set to `"lazy"` to defer
	 * clientFactory execution until `initialize(key)` is called.
	 */
	initialization?: ClientInitializationMode;
	urlPatterns?: ReadonlyArray<string | RegExp | ((url: string) => boolean)>;
	callbackPath?: string;
	requirementKind?: string;
	providerFamily?: string;
}
