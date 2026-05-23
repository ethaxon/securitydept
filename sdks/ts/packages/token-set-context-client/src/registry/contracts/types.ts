// Shared registry — framework-neutral type contracts
//
// Canonical subpath: @securitydept/token-set-context-client/registry
//
// These types define the shape of a multi-client token-set auth registry
// that is *independent* of Angular / React. Framework adapters build thin
// wrappers over the core registry; the lifecycle / readiness / discrimination
// semantics live here.

import type {
	EventStreamTrait,
	EventSubscriptionTrait,
	FoundationEnvironment,
	ReadableReplaySignalTrait,
	ReadableSignalTrait,
	RouterTrait,
} from "@securitydept/client";
import type { ClientReadinessState } from "../../frontend-oidc-mode/config/config-source";
import type {
	AuthCheckOptions,
	AuthCheckResult,
	AuthSnapshot,
	TokenSetAuthEvent,
	TokenSetAuthOperationSignals,
	TokenSetAuthWorkflowSource,
} from "../../orchestration";

export type {
	TokenSetCallbackResumeControllerOptions,
	TokenSetCallbackResumeOptions,
	TokenSetCallbackResumeRegistry,
	TokenSetCallbackResumeResult,
	TokenSetCallbackResumeState,
	TokenSetCallbackResumeStatus,
} from "../controller/callback-resume-controller";
export type {
	ReadTokenSetCallbackResumeErrorDetailsOptions,
	TokenSetCallbackErrorDetails,
	TokenSetCallbackErrorPresentationContext,
	TokenSetCallbackErrorPresenter,
	TokenSetCallbackResumeErrorDetails,
} from "../presentation/error-presentation";
export type { ClientReadinessState };

// ---------------------------------------------------------------------------
// Shared managed OIDC client contracts
// ---------------------------------------------------------------------------

/**
 * Framework-neutral contract for an OIDC mode client managed by the shared
 * token-set registry family.
 */
export interface OidcModeClient {
	authDetermined: ReadableReplaySignalTrait<true>;
	authSnapshot: ReadableReplaySignalTrait<AuthSnapshot | null>;
	isAuthenticated: ReadableReplaySignalTrait<boolean>;
	authorizationHeaderValue: ReadableReplaySignalTrait<string | undefined>;
	lastAuthError: ReadableSignalTrait<unknown | undefined>;
	authOperations: TokenSetAuthOperationSignals;
	authEvents: EventStreamTrait<TokenSetAuthEvent>;
	start(): Promise<void>;
	addWorkflowSource(source: TokenSetAuthWorkflowSource): EventSubscriptionTrait;
	removeWorkflowSource(source: TokenSetAuthWorkflowSource): boolean;
	authCheck(options?: AuthCheckOptions): Promise<AuthCheckResult>;
	dispose(): void;
	/** Manual persistence re-sync. Initial readiness should prefer start()/whenReady(). */
	restorePersistedState(): Promise<AuthSnapshot | null>;
}

/**
 * Framework-neutral browser redirect-login options shared by frontend and
 * backend OIDC flows.
 */
export interface OidcRedirectLoginOptions {
	/** Explicit page navigation capability used to start the browser redirect. */
	environment: RouterTrait;
	/**
	 * Where to redirect the user after successful authentication.
	 *
	 * When omitted, the client-specific default is used.
	 */
	postAuthRedirectUri?: string;
}

/**
 * Framework-neutral contract for a managed OIDC client that can start an
 * external browser redirect login flow.
 */
export interface OidcRedirectLoginClient {
	loginWithRedirect(options: OidcRedirectLoginOptions): Promise<void>;
}

/**
 * Framework-neutral contract for a managed OIDC client that can resume an
 * authorization callback.
 */
export interface OidcCallbackClient {
	handleCallback(callbackUrl: string): Promise<{
		snapshot: AuthSnapshot;
		postAuthRedirectUri?: string;
	}>;
}

// ---------------------------------------------------------------------------
// Initialization priority — primary (eager) vs lazy (idle warmup)
// ---------------------------------------------------------------------------

/**
 * How aggressively the registry should materialize a client.
 *
 * - `"primary"` (default) — client is expected to be ready for the main
 *   authenticated surface; callers should `whenReady(key)` in guards.
 *   Angular's `provideEnvironmentInitializer` registers primary clients
 *   eagerly on app bootstrap. React's provider-scoped token-set runtime
 *   factories register primary clients when the enclosing provider scope
 *   is constructed.
 *
 * - `"lazy"` — client is registered but not materialized until explicitly
 *   asked for via `preload(key)` / `whenReady(key)` / `idleWarmup()`.
 *   Use for provider variants gated behind rarely-visited routes (admin
 *   console, reporting dashboard, etc.).
 */
export const ClientInitializationPriority = {
	Primary: "primary",
	Lazy: "lazy",
} as const;

export type ClientInitializationPriority =
	(typeof ClientInitializationPriority)[keyof typeof ClientInitializationPriority];

// ---------------------------------------------------------------------------
// Registered client entry
// ---------------------------------------------------------------------------

/**
 * A single client registration entry for the shared token-set auth registry.
 *
 * The registry is generic over `TClient` (the raw OIDC client type) so
 * Angular and React can both register `OidcModeClient & OidcCallbackClient`
 * instances against a core registry without coupling the core to either
 * framework's DI / hook primitives.
 */
export interface TokenSetClientEntry<TClient> {
	/** Unique key for this client within the registry. */
	key: string;
	/**
	 * Factory that returns the materialized client. Can be sync or async.
	 *
	 * Async factories are the common case when the client needs to fetch
	 * a config projection from the backend before it can be instantiated.
	 */
	clientFactory: (
		environment: FoundationEnvironment | undefined,
	) => TClient | Promise<TClient>;
	/**
	 * Initialization priority.
	 * @default "primary"
	 */
	priority?: ClientInitializationPriority;
	/**
	 * URL patterns this client's bearer token should be applied to.
	 * Used by interceptors to select the correct client by request URL.
	 */
	urlPatterns?: ReadonlyArray<string | RegExp | ((url: string) => boolean)>;
	/**
	 * Callback path for OIDC redirect callback detection. Used by callback
	 * outlet components to route incoming callbacks to the correct client.
	 */
	callbackPath?: string;
	/**
	 * The requirement kind (opaque string) this client satisfies.
	 *
	 * When set, `registry.clientKeyForRequirement(kind)` returns this key,
	 * letting guards / orchestrators look up the right client without
	 * knowing the concrete key.
	 */
	requirementKind?: string;
	/**
	 * The provider family this client belongs to (e.g. `"authentik"`,
	 * `"google"`, `"internal-sso"`). Useful when several clients share the
	 * same `requirementKind` but differ by provider / audience.
	 */
	providerFamily?: string;
}

// ---------------------------------------------------------------------------
// Client meta — reflective metadata for selectors / filters
// ---------------------------------------------------------------------------

/**
 * Reflective metadata for a registered client, passed to selectors so
 * callers can make decisions based on any combination of dimensions.
 */
export interface ClientMeta {
	readonly clientKey: string;
	readonly urlPatterns: ReadonlyArray<
		string | RegExp | ((url: string) => boolean)
	>;
	readonly callbackPath: string | undefined;
	readonly requirementKind: string | undefined;
	readonly providerFamily: string | undefined;
	readonly priority: ClientInitializationPriority;
}

export interface TokenSetAuthRegistryEntryState<TClient> {
	readonly key: string;
	readonly entry: TokenSetClientEntry<TClient>;
	readonly meta: ClientMeta;
	readonly readiness: ClientReadinessState;
	readonly generation: number;
	readonly lifecycleError: TokenSetAuthRegistryLifecycleError | unknown | null;
}

export interface TokenSetAuthRegistryState<TClient> {
	readonly entries: ReadonlyArray<TokenSetAuthRegistryEntryState<TClient>>;
	readonly registeredKeys: readonly string[];
	readonly readyKeys: readonly string[];
}

export const TokenSetAuthRegistryLifecycleErrorCode = {
	ClientUnregistered: "client_unregistered",
	MaterializationReset: "materialization_reset",
} as const;

export type TokenSetAuthRegistryLifecycleErrorCode =
	(typeof TokenSetAuthRegistryLifecycleErrorCode)[keyof typeof TokenSetAuthRegistryLifecycleErrorCode];

export class TokenSetAuthRegistryLifecycleError extends Error {
	readonly code: TokenSetAuthRegistryLifecycleErrorCode;
	readonly clientKey: string;

	constructor(options: {
		code: TokenSetAuthRegistryLifecycleErrorCode;
		clientKey: string;
		message?: string;
	}) {
		super(
			options.message ??
				defaultTokenSetAuthRegistryLifecycleErrorMessage(
					options.code,
					options.clientKey,
				),
		);
		this.name = "TokenSetAuthRegistryLifecycleError";
		this.code = options.code;
		this.clientKey = options.clientKey;
		Object.setPrototypeOf(this, TokenSetAuthRegistryLifecycleError.prototype);
		const captureStackTrace = (
			Error as ErrorConstructor & {
				captureStackTrace?: (
					targetObject: object,
					constructorOpt?: abstract new (...args: never[]) => unknown,
				) => void;
			}
		).captureStackTrace;
		if (typeof captureStackTrace === "function") {
			captureStackTrace(this, TokenSetAuthRegistryLifecycleError);
		}
	}
}

function defaultTokenSetAuthRegistryLifecycleErrorMessage(
	code: TokenSetAuthRegistryLifecycleErrorCode,
	clientKey: string,
): string {
	switch (code) {
		case TokenSetAuthRegistryLifecycleErrorCode.ClientUnregistered:
			return `[TokenSetAuthRegistry] Client "${clientKey}" was unregistered before materialization completed.`;
		case TokenSetAuthRegistryLifecycleErrorCode.MaterializationReset:
			return `[TokenSetAuthRegistry] Client "${clientKey}" materialization was reset before materialization completed.`;
	}
}

/**
 * Predicate used to select among multiple matching clients.
 */
export type ClientKeySelector = (meta: ClientMeta, index: number) => boolean;

/**
 * A single filter clause for {@link ClientQueryOptions}.
 *
 * All non-undefined fields form an AND conjunction. To express OR semantics,
 * pass an array of `ClientFilter` objects.
 */
export interface ClientFilter {
	url?: string;
	callbackUrl?: string;
	providerFamily?: string;
	requirementKind?: string;
	selector?: ClientKeySelector;
}

export type ClientQueryOptions = ClientFilter | ClientFilter[];

// ---------------------------------------------------------------------------
// Registry factory options
// ---------------------------------------------------------------------------

/**
 * Options for {@link createTokenSetAuthRegistry}.
 *
 * Framework adapters pass a `materialize` callback that wraps the raw
 * client in a framework-idiomatic service object (Angular signals wrapper,
 * React external-store wrapper, etc.). The registry itself stays generic.
 */
export interface CreateTokenSetAuthRegistryOptions<TClient, TService> {
	/**
	 * Convert a freshly-materialized client into the object stored in the
	 * registry and returned from `whenReady()` / `clientSignalFor()`.
	 */
	materialize: (
		client: TClient,
		entry: TokenSetClientEntry<TClient>,
	) => TService;
	/**
	 * Dispose a previously-materialized object. Called from
	 * `registry.dispose()`, `registry.unregister(key)`, and
	 * `registry.resetMaterialization(key)`.
	 */
	dispose: (service: TService) => void;
	/**
	 * Start the materialized object before the registry marks it ready.
	 *
	 * Generic registries default this to a no-op. OIDC registry wiring uses
	 * it to call `client.start()` so registry readiness means materialized and
	 * started.
	 */
	start?: (
		client: TClient,
		service: TService,
		entry: TokenSetClientEntry<TClient>,
	) => Promise<void> | void;
	authEventsOf: (service: TService) => EventStreamTrait<TokenSetAuthEvent>;
	/**
	 * Client environment owned by the registry composition root.
	 *
	 * The registry reads lifecycle capabilities from this object, such as
	 * `environment.idleCallback` for {@link TokenSetAuthRegistry.idleWarmup}.
	 */
	environment?: FoundationEnvironment;
}

export interface CreateTokenSetOidcAuthRegistryOptions {
	/**
	 * Client environment owned by the registry composition root.
	 *
	 * The OIDC registry reads lifecycle capabilities from this object, such as
	 * `environment.idleCallback` for {@link TokenSetAuthRegistry.idleWarmup}.
	 */
	environment?: FoundationEnvironment;
}
