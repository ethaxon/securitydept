import type {
	ClientInitializationPriority,
	TokenSetClientEntry as CoreTokenSetClientEntry,
	OidcCallbackClient,
	OidcModeClient,
} from "@securitydept/token-set-context-client/registry";

// ============================================================================
// 2. Client contracts
// ============================================================================

export type { OidcCallbackClient, OidcModeClient };

export type TokenSetAngularClient = OidcModeClient & OidcCallbackClient;

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
 * - **Sync** (`() => OidcModeClient`): The client config is available at
 *   registration time. Classic inline config or pre-resolved projections.
 *
 * - **Async** (`() => Promise<OidcModeClient>`): The client config must be
 *   resolved asynchronously (e.g. fetched from a backend config projection
 *   endpoint). The registry tracks readiness state and provides `whenReady()`
 *   for guards/interceptors that need to wait.
 *
 * When `clientFactory` returns a Promise, the registry enters
 * `ClientReadinessState.Initializing` for this key and transitions to
 * `Ready` or `Failed` when the promise settles.
 *
 * Two additional discrimination axes are supported:
 *   - `requirementKind`: maps a RequirementKind (or custom string) → this client.
 *     Guards and resolvers can look up the client for a pending requirement without
 *     knowing the concrete key.
 *   - `providerFamily`: maps a named provider family (e.g. "google", "internal-sso")
 *     → this client. Useful when multiple clients share the same kind but differ
 *     by provider / audience.
 */
export interface TokenSetClientEntry
	extends Omit<
		CoreTokenSetClientEntry<TokenSetAngularClient>,
		"clientFactory"
	> {
	/**
	 * Factory that creates the OIDC mode client.
	 *
	 * May return the client synchronously (inline config) or a Promise
	 * (async config projection resolution). When a Promise is returned,
	 * the registry tracks initialization readiness automatically.
	 */
	clientFactory: () => TokenSetAngularClient | Promise<TokenSetAngularClient>;
	/**
	 * Initialization priority. Defaults to `"primary"` (eager). Set to
	 * `"lazy"` to defer clientFactory execution until the registry is asked
	 * for this key via `whenReady(key)` / `preload(key)` / `idleWarmup()`.
	 */
	priority?: ClientInitializationPriority;
}
