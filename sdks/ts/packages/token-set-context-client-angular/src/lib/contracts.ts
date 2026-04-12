import type { ReadableSignalTrait } from "@securitydept/client";
import type { AuthSnapshot } from "@securitydept/token-set-context-client/orchestration";
import type { ClientInitializationPriority } from "@securitydept/token-set-context-client/registry";

// ============================================================================
// 2. Client contracts
// ============================================================================

/**
 * Duck-typed contract for an OIDC mode client managed by this adapter.
 *
 * Compatible with both `FrontendOidcModeClient` and `BackendOidcModeClient`.
 */
export interface OidcModeClient {
	state: ReadableSignalTrait<AuthSnapshot | null>;
	dispose(): void;
	restorePersistedState(): Promise<AuthSnapshot | null>;
}

/**
 * Duck-typed contract for an OIDC client that can handle callbacks.
 */
export interface OidcCallbackClient {
	handleCallback(callbackUrl: string): Promise<{
		snapshot: AuthSnapshot;
		postAuthRedirectUri?: string;
	}>;
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
export interface TokenSetClientEntry {
	/** Unique key identifying this client in the registry. */
	key: string;
	/**
	 * Factory that creates the OIDC mode client.
	 *
	 * May return the client synchronously (inline config) or a Promise
	 * (async config projection resolution). When a Promise is returned,
	 * the registry tracks initialization readiness automatically.
	 */
	clientFactory: () =>
		| (OidcModeClient & OidcCallbackClient)
		| Promise<OidcModeClient & OidcCallbackClient>;
	/**
	 * Whether to auto-restore persisted state on service initialization.
	 * @default true
	 */
	autoRestore?: boolean;
	/**
	 * URL patterns this client's bearer token should be applied to.
	 * Used by the multi-client interceptor to select the right token.
	 *
	 * Accepts strings (prefix match), RegExp, or predicate functions for
	 * full control. Functions receive the full request URL.
	 */
	urlPatterns?: Array<string | RegExp | ((url: string) => boolean)>;
	/**
	 * Callback path for OIDC redirect callback detection.
	 * Used by CallbackResumeService to route callbacks to the correct client.
	 */
	callbackPath?: string;
	/**
	 * The requirement kind this client satisfies.
	 *
	 * When set, `registry.clientKeyForRequirement(kind)` will return this
	 * client's key. This lets guards and resolvers select the right client for
	 * a pending `AuthRequirement` without knowing the concrete key.
	 *
	 * Matches `AuthRequirement.kind` opaque string values from
	 * `@securitydept/client/auth-coordination`, or any custom
	 * string you define for non-standard requirement kinds.
	 *
	 * @example
	 * ```ts
	 * { key: "main", requirementKind: "backend_oidc", ... }
	 * { key: "admin", requirementKind: "frontend_oidc", ... }
	 * ```
	 */
	requirementKind?: string;
	/**
	 * The provider family name this client belongs to.
	 *
	 * When set, `registry.clientKeyForProviderFamily(family)` will return this
	 * client's key. Use this when multiple clients share the same `requirementKind`
	 * but differ by provider / audience / tenant.
	 *
	 * @example
	 * ```ts
	 * { key: "google", providerFamily: "google", ... }
	 * { key: "internal", providerFamily: "internal-sso", ... }
	 * ```
	 */
	providerFamily?: string;
	/**
	 * Initialization priority. Defaults to `"primary"` (eager). Set to
	 * `"lazy"` to defer clientFactory execution until the registry is asked
	 * for this key via `whenReady(key)` / `preload(key)` / `idleWarmup()`.
	 */
	priority?: ClientInitializationPriority;
}
