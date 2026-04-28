// Framework-neutral multi-client token-set auth registry
//
// Canonical subpath: @securitydept/token-set-context-client/registry
//
// The registry owns:
//   - keyed storage of materialized services (any framework wrapper)
//   - readiness tracking (ClientReadinessState) with pending-promise reuse
//   - priority-aware lifecycle: primary (eager) vs lazy (idle warmup)
//   - preload / whenReady / idleWarmup / reset semantics
//   - multi-axis discrimination (urlPatterns / callbackPath /
//     requirementKind / providerFamily), with AND / OR filter queries
//
// The registry does NOT own:
//   - framework DI (Angular Injectable, React Context)
//   - framework teardown (DestroyRef, useEffect cleanup) — adapters call
//     `registry.dispose()` at the right moment
//   - token-set-specific business semantics (that lives in the materialize
//     callback supplied by the adapter)

import { ClientReadinessState } from "../frontend-oidc-mode/config-source";
import { isOidcCallback } from "./oidc-callback-url";
import {
	type ClientFilter,
	ClientInitializationPriority,
	type ClientKeySelector,
	type ClientMeta,
	type ClientQueryOptions,
	type CreateTokenSetAuthRegistryOptions,
	type TokenSetClientEntry,
} from "./types";

// ---------------------------------------------------------------------------
// Pending registration — tracks async clientFactory lifecycle
// ---------------------------------------------------------------------------

interface PendingRegistration<TService> {
	readonly promise: Promise<TService>;
	state: ClientReadinessState;
}

// ---------------------------------------------------------------------------
// Idle scheduler default
// ---------------------------------------------------------------------------

function defaultIdleScheduler(callback: () => void): () => void {
	const ric = (
		globalThis as { requestIdleCallback?: (cb: () => void) => number }
	).requestIdleCallback;
	const cic = (globalThis as { cancelIdleCallback?: (h: number) => void })
		.cancelIdleCallback;
	if (typeof ric === "function") {
		const handle = ric(callback);
		return () => {
			if (typeof cic === "function") cic(handle);
		};
	}
	const handle = setTimeout(callback, 0);
	return () => clearTimeout(handle);
}

// ---------------------------------------------------------------------------
// Framework-neutral registry class
// ---------------------------------------------------------------------------

/**
 * Framework-neutral multi-client token-set auth registry.
 *
 * Instantiated by framework adapters (Angular's `TokenSetAuthRegistry` DI
 * wrapper, React's `TokenSetAuthProvider`). The adapter supplies a
 * `materialize` callback that wraps a raw `OidcModeClient` in a
 * framework-idiomatic service.
 *
 * ## Lifecycle states (per key)
 *
 * ```
 *   register()  ─┬──> not_initialized  (priority=lazy, not preloaded)
 *                ├──> initializing     (clientFactory returned a Promise)
 *                ├──> ready            (materialization succeeded)
 *                └──> failed           (materialization rejected)
 *
 *   preload(key) / whenReady(key) / idleWarmup()
 *                 trigger transitions from not_initialized → initializing
 * ```
 *
 * ## Priority model
 *
 * - `priority: "primary"` (default): clientFactory runs eagerly at
 *   `register()` time (just like iteration 108's model).
 * - `priority: "lazy"`: the entry is recorded, metadata is indexed, but
 *   `clientFactory` does **not** run until `preload(key)` /
 *   `whenReady(key)` / `idleWarmup()` is called.
 *
 * ## Thread-safety
 *
 * The registry is single-threaded (JS event loop). Concurrent
 * `whenReady(key)` / `preload(key)` calls during `initializing` state
 * return the same pending promise.
 */
export class TokenSetAuthRegistry<TClient, TService> {
	private readonly materialize: (
		client: TClient,
		entry: TokenSetClientEntry<TClient>,
	) => TService;
	private readonly _dispose: ((service: TService) => void) | undefined;
	private readonly _accessTokenOf:
		| ((service: TService) => string | null)
		| undefined;
	private readonly _ensureAccessTokenOf:
		| ((service: TService) => Promise<string | null>)
		| undefined;
	private readonly _ensureAuthorizationHeaderOf:
		| ((service: TService) => Promise<string | null>)
		| undefined;
	private readonly idleScheduler: (callback: () => void) => () => void;

	// Materialized services (after clientFactory resolves)
	private readonly services = new Map<string, TService>();
	// Raw registration entries (kept so we can re-run clientFactory for lazy
	// clients and reset()).
	private readonly entries = new Map<string, TokenSetClientEntry<TClient>>();
	// Metadata reflected for selectors / filters.
	private readonly metas = new Map<string, ClientMeta>();
	// urlPatterns → key rules
	private readonly urlRules: Array<{
		key: string;
		patterns: ReadonlyArray<string | RegExp | ((url: string) => boolean)>;
	}> = [];
	private readonly callbackPaths = new Map<string, string>();
	private readonly requirementKindMap = new Map<string, string[]>();
	private readonly providerFamilyMap = new Map<string, string[]>();
	// Pending async materialization.
	private readonly pendingRegistrations = new Map<
		string,
		PendingRegistration<TService>
	>();

	constructor(options: CreateTokenSetAuthRegistryOptions<TClient, TService>) {
		this.materialize = options.materialize;
		this._dispose = options.dispose;
		this._accessTokenOf = options.accessTokenOf;
		this._ensureAccessTokenOf = options.ensureAccessTokenOf;
		this._ensureAuthorizationHeaderOf = options.ensureAuthorizationHeaderOf;
		this.idleScheduler = options.idleScheduler ?? defaultIdleScheduler;
	}

	// -------------------------------------------------------------------
	// Registration
	// -------------------------------------------------------------------

	/**
	 * Register a client entry.
	 *
	 * - `priority: "primary"` (default): materialize immediately. Returns
	 *   the service synchronously if the factory is sync, or a Promise if
	 *   the factory is async.
	 * - `priority: "lazy"`: record the entry only. Returns `undefined`.
	 *   Call `whenReady(key)` / `preload(key)` to materialize later.
	 *
	 * @throws If `entry.key` is already registered.
	 */
	register(
		entry: TokenSetClientEntry<TClient>,
	): TService | Promise<TService> | undefined {
		if (this.entries.has(entry.key)) {
			throw new Error(
				`[TokenSetAuthRegistry] Duplicate registration for key "${entry.key}".`,
			);
		}
		this.entries.set(entry.key, entry);
		this.indexMeta(entry);

		const priority = entry.priority ?? ClientInitializationPriority.Primary;
		if (priority === ClientInitializationPriority.Lazy) {
			// Lazy: defer materialization until asked.
			return undefined;
		}
		return this.materializeEntry(entry);
	}

	private indexMeta(entry: TokenSetClientEntry<TClient>): void {
		const meta: ClientMeta = {
			clientKey: entry.key,
			urlPatterns: entry.urlPatterns ?? [],
			callbackPath: entry.callbackPath,
			requirementKind: entry.requirementKind,
			providerFamily: entry.providerFamily,
			priority: entry.priority ?? ClientInitializationPriority.Primary,
		};
		this.metas.set(entry.key, meta);

		if (entry.urlPatterns?.length) {
			this.urlRules.push({ key: entry.key, patterns: entry.urlPatterns });
		}
		if (entry.callbackPath) {
			this.callbackPaths.set(entry.key, entry.callbackPath);
		}
		if (entry.requirementKind) {
			const list = this.requirementKindMap.get(entry.requirementKind) ?? [];
			list.push(entry.key);
			this.requirementKindMap.set(entry.requirementKind, list);
		}
		if (entry.providerFamily) {
			const list = this.providerFamilyMap.get(entry.providerFamily) ?? [];
			list.push(entry.key);
			this.providerFamilyMap.set(entry.providerFamily, list);
		}
	}

	private materializeEntry(
		entry: TokenSetClientEntry<TClient>,
	): TService | Promise<TService> {
		// If materialization is already in flight or complete, return existing.
		const existing = this.services.get(entry.key);
		if (existing !== undefined) return existing;
		const pending = this.pendingRegistrations.get(entry.key);
		if (pending) return pending.promise;

		const clientOrPromise = entry.clientFactory();

		if (clientOrPromise instanceof Promise) {
			const pendingEntry: PendingRegistration<TService> = {
				promise: clientOrPromise.then(
					(client) => {
						const service = this.materialize(client, entry);
						this.services.set(entry.key, service);
						pendingEntry.state = ClientReadinessState.Ready;
						return service;
					},
					(error) => {
						pendingEntry.state = ClientReadinessState.Failed;
						throw error;
					},
				),
				state: ClientReadinessState.Initializing,
			};
			this.pendingRegistrations.set(entry.key, pendingEntry);
			return pendingEntry.promise;
		}

		const service = this.materialize(clientOrPromise, entry);
		this.services.set(entry.key, service);
		return service;
	}

	// -------------------------------------------------------------------
	// Readiness API
	// -------------------------------------------------------------------

	/** True when `get(key)` would return a service. */
	isReady(key: string): boolean {
		return this.services.has(key);
	}

	/**
	 * Current readiness state for a key.
	 *
	 * - `"not_initialized"` — unregistered, or registered lazy but not yet
	 *   preloaded
	 * - `"initializing"` — async factory is in flight
	 * - `"ready"` — service is materialized
	 * - `"failed"` — async factory rejected (no automatic retry; call
	 *   `reset(key)` then re-register to retry)
	 */
	readinessState(key: string): ClientReadinessState {
		if (this.services.has(key)) return ClientReadinessState.Ready;
		const pending = this.pendingRegistrations.get(key);
		if (pending) return pending.state;
		return ClientReadinessState.NotInitialized;
	}

	/**
	 * Await materialization for a key. Triggers materialization if the key
	 * was registered lazy and hasn't been preloaded yet. Rejects if the key
	 * is unregistered or the factory fails.
	 */
	async whenReady(key: string): Promise<TService> {
		const existing = this.services.get(key);
		if (existing) return existing;

		const pending = this.pendingRegistrations.get(key);
		if (pending) return pending.promise;

		const entry = this.entries.get(key);
		if (!entry) {
			throw new Error(
				`[TokenSetAuthRegistry] No client registered for key "${key}". ` +
					`Available keys: ${[...this.entries.keys()].join(", ")}`,
			);
		}

		// Lazy client that hasn't been materialized yet — kick it off now.
		const result = this.materializeEntry(entry);
		return result instanceof Promise ? result : Promise.resolve(result);
	}

	/**
	 * Start materialization without throwing on rejection.
	 *
	 * Returns the same pending promise `whenReady(key)` would, but callers
	 * are expected to catch errors on their own terms (telemetry, ignore,
	 * fall back to `reset`). Use from application startup paths that want
	 * to warm a lazy client without blocking the render tree.
	 */
	preload(key: string): Promise<TService> {
		return this.whenReady(key).catch((err) => {
			// Re-throw so callers can still react; `.catch(() => {})` is the
			// idiomatic fire-and-forget.
			throw err;
		});
	}

	/**
	 * Schedule `preload()` for every registered key whose priority is
	 * `"lazy"` and whose current readiness is `"not_initialized"`.
	 *
	 * Uses `requestIdleCallback` when available, `setTimeout(0)` otherwise.
	 * Returns a cancel function that aborts pending (not-yet-fired) warmups.
	 */
	idleWarmup(): () => void {
		const cancels: Array<() => void> = [];
		for (const [key, entry] of this.entries) {
			if (
				(entry.priority ?? ClientInitializationPriority.Primary) !==
				ClientInitializationPriority.Lazy
			) {
				continue;
			}
			if (this.readinessState(key) !== ClientReadinessState.NotInitialized) {
				continue;
			}
			const cancel = this.idleScheduler(() => {
				this.preload(key).catch(() => {
					// Swallow: callers who care use whenReady() instead.
				});
			});
			cancels.push(cancel);
		}
		return () => {
			for (const cancel of cancels) cancel();
		};
	}

	/**
	 * Drop a registered client entirely. Disposes the materialized service
	 * (if any), clears readiness state, and removes metadata.
	 *
	 * Use this to retry a failed async materialization — call `reset(key)`
	 * then re-`register()`.
	 */
	reset(key: string): void {
		const service = this.services.get(key);
		if (service !== undefined && this._dispose) {
			try {
				this._dispose(service);
			} catch {
				// Swallow; dispose is best-effort.
			}
		}
		this.services.delete(key);
		this.entries.delete(key);
		this.metas.delete(key);
		this.pendingRegistrations.delete(key);
		this.callbackPaths.delete(key);
		for (let i = this.urlRules.length - 1; i >= 0; i--) {
			if (this.urlRules[i].key === key) {
				this.urlRules.splice(i, 1);
			}
		}
		for (const [kind, keys] of this.requirementKindMap) {
			const filtered = keys.filter((k) => k !== key);
			if (filtered.length === 0) {
				this.requirementKindMap.delete(kind);
			} else {
				this.requirementKindMap.set(kind, filtered);
			}
		}
		for (const [family, keys] of this.providerFamilyMap) {
			const filtered = keys.filter((k) => k !== key);
			if (filtered.length === 0) {
				this.providerFamilyMap.delete(family);
			} else {
				this.providerFamilyMap.set(family, filtered);
			}
		}
	}

	/**
	 * Dispose all materialized services and clear all state.
	 *
	 * Called by adapters at framework teardown (Angular `DestroyRef`,
	 * React `useEffect` cleanup).
	 */
	dispose(): void {
		if (this._dispose) {
			for (const service of this.services.values()) {
				try {
					this._dispose(service);
				} catch {
					// Swallow per-service errors.
				}
			}
		}
		this.services.clear();
		this.entries.clear();
		this.metas.clear();
		this.pendingRegistrations.clear();
		this.urlRules.length = 0;
		this.callbackPaths.clear();
		this.requirementKindMap.clear();
		this.providerFamilyMap.clear();
	}

	// -------------------------------------------------------------------
	// Lookup API
	// -------------------------------------------------------------------

	get(key: string): TService | undefined {
		return this.services.get(key);
	}

	require(key: string): TService {
		const service = this.services.get(key);
		if (!service) {
			throw new Error(
				`[TokenSetAuthRegistry] No client registered for key "${key}" (and ready). ` +
					`Available keys: ${[...this.services.keys()].join(", ")}`,
			);
		}
		return service;
	}

	keys(): string[] {
		return [...this.services.keys()];
	}

	entriesSnapshot(): Array<[string, TService]> {
		return [...this.services.entries()];
	}

	metaFor(clientKey: string): ClientMeta | undefined {
		return this.metas.get(clientKey);
	}

	// -------------------------------------------------------------------
	// URL pattern discrimination
	// -------------------------------------------------------------------

	private matchesUrl(
		pattern: string | RegExp | ((u: string) => boolean),
		url: string,
	): boolean {
		if (typeof pattern === "string") return url.startsWith(pattern);
		if (typeof pattern === "function") return pattern(url);
		return pattern.test(url);
	}

	*clientKeyGenForUrl(url: string): Generator<string, void, unknown> {
		for (const rule of this.urlRules) {
			for (const pattern of rule.patterns) {
				if (this.matchesUrl(pattern, url)) {
					yield rule.key;
					break;
				}
			}
		}
	}

	*clientKeyGenForCallback(url: string): Generator<string, void, unknown> {
		for (const [key, callbackPath] of this.callbackPaths) {
			if (isOidcCallback({ currentUrl: url, callbackPath })) {
				yield key;
			}
		}
	}

	*clientKeyGenForRequirement(
		requirementKind: string,
	): Generator<string, void, unknown> {
		const keys = this.requirementKindMap.get(requirementKind) ?? [];
		yield* keys;
	}

	*clientKeyGenForProviderFamily(
		providerFamily: string,
	): Generator<string, void, unknown> {
		const keys = this.providerFamilyMap.get(providerFamily) ?? [];
		yield* keys;
	}

	clientKeyListForUrl(url: string): string[] {
		return [...this.clientKeyGenForUrl(url)];
	}

	clientKeyListForCallback(url: string): string[] {
		return [...this.clientKeyGenForCallback(url)];
	}

	clientKeyListForRequirement(requirementKind: string): string[] {
		return [...this.clientKeyGenForRequirement(requirementKind)];
	}

	clientKeyListForProviderFamily(providerFamily: string): string[] {
		return [...this.clientKeyGenForProviderFamily(providerFamily)];
	}

	clientKeyForUrl(
		url: string,
		selector?: ClientKeySelector,
	): string | undefined {
		return this.pickFirst(this.clientKeyGenForUrl(url), selector);
	}

	clientKeyForCallback(
		url: string,
		selector?: ClientKeySelector,
	): string | undefined {
		return this.pickFirst(this.clientKeyGenForCallback(url), selector);
	}

	clientKeyForRequirement(
		requirementKind: string,
		selector?: ClientKeySelector,
	): string | undefined {
		return this.pickFirst(
			this.clientKeyGenForRequirement(requirementKind),
			selector,
		);
	}

	clientKeyForProviderFamily(
		providerFamily: string,
		selector?: ClientKeySelector,
	): string | undefined {
		return this.pickFirst(
			this.clientKeyGenForProviderFamily(providerFamily),
			selector,
		);
	}

	/** Pick-first helper with optional selector predicate. */
	private pickFirst(
		keys: Iterable<string>,
		selector?: ClientKeySelector,
	): string | undefined {
		let index = 0;
		for (const key of keys) {
			const meta = this.metas.get(key);
			if (!meta) continue;
			if (!selector || selector(meta, index)) return key;
			index++;
		}
		return undefined;
	}

	requireForRequirement(
		requirementKind: string,
		selector?: ClientKeySelector,
	): TService {
		const key = this.clientKeyForRequirement(requirementKind, selector);
		if (!key) {
			throw new Error(
				`[TokenSetAuthRegistry] No client registered for requirementKind "${requirementKind}". ` +
					`Registered kinds: ${[...this.requirementKindMap.keys()].join(", ")}`,
			);
		}
		return this.require(key);
	}

	requireForProviderFamily(
		providerFamily: string,
		selector?: ClientKeySelector,
	): TService {
		const key = this.clientKeyForProviderFamily(providerFamily, selector);
		if (!key) {
			throw new Error(
				`[TokenSetAuthRegistry] No client registered for providerFamily "${providerFamily}". ` +
					`Registered families: ${[...this.providerFamilyMap.keys()].join(", ")}`,
			);
		}
		return this.require(key);
	}

	// -------------------------------------------------------------------
	// Composite queries (ClientFilter — AND; ClientQueryOptions — OR-of-AND)
	// -------------------------------------------------------------------

	*clientKeyGenForFilter(
		filter: ClientFilter,
	): Generator<string, void, unknown> {
		let candidates: string[] | undefined;

		const narrow = (keys: Iterable<string>): string[] => {
			const arr = [...keys];
			return candidates === undefined
				? arr
				: candidates.filter((k) => arr.includes(k));
		};

		if (filter.requirementKind !== undefined) {
			candidates = narrow(
				this.clientKeyGenForRequirement(filter.requirementKind),
			);
		}
		if (filter.providerFamily !== undefined) {
			candidates = narrow(
				this.clientKeyGenForProviderFamily(filter.providerFamily),
			);
		}
		if (filter.url !== undefined) {
			candidates = narrow(this.clientKeyGenForUrl(filter.url));
		}
		if (filter.callbackUrl !== undefined) {
			candidates = narrow(this.clientKeyGenForCallback(filter.callbackUrl));
		}

		const pool = candidates ?? [...this.entries.keys()];

		let index = 0;
		for (const key of pool) {
			const meta = this.metas.get(key);
			if (!meta) continue;
			if (!filter.selector || filter.selector(meta, index)) {
				yield key;
				index++;
			}
		}
	}

	*clientKeyGenForOptions(
		options: ClientQueryOptions,
	): Generator<string, void, unknown> {
		const filters = Array.isArray(options) ? options : [options];
		const seen = new Set<string>();
		for (const filter of filters) {
			for (const key of this.clientKeyGenForFilter(filter)) {
				if (!seen.has(key)) {
					seen.add(key);
					yield key;
				}
			}
		}
	}

	clientKeysForOptions(options: ClientQueryOptions): string[] {
		return [...this.clientKeyGenForOptions(options)];
	}

	// -------------------------------------------------------------------
	// Access-token sugar (opt-in via accessTokenOf option)
	// -------------------------------------------------------------------

	/**
	 * Get the current access token for a key (or the first available token
	 * across all clients when no key is given).
	 *
	 * Returns `null` when:
	 *   - No key is registered
	 *   - The matching client is not yet ready (initializing / lazy)
	 *   - No `accessTokenOf` option was supplied at construction time
	 */
	accessToken(key?: string): string | null {
		if (!this._accessTokenOf) return null;
		if (key) {
			const service = this.services.get(key);
			return service ? this._accessTokenOf(service) : null;
		}
		for (const service of this.services.values()) {
			const token = this._accessTokenOf(service);
			if (token) return token;
		}
		return null;
	}

	async ensureAccessToken(key?: string): Promise<string | null> {
		if (!this._ensureAccessTokenOf) return null;
		if (key) {
			const service = this.services.get(key);
			return service ? await this._ensureAccessTokenOf(service) : null;
		}
		const services = [...this.services.values()];
		if (services.length > 1) {
			throw new Error(
				"[TokenSetAuthRegistry] ensureAccessToken() without a key is only valid for a single ready client.",
			);
		}
		const [service] = services;
		return service ? await this._ensureAccessTokenOf(service) : null;
	}

	async ensureAuthorizationHeader(key?: string): Promise<string | null> {
		if (!this._ensureAuthorizationHeaderOf) return null;
		if (key) {
			const service = this.services.get(key);
			return service ? await this._ensureAuthorizationHeaderOf(service) : null;
		}
		const services = [...this.services.values()];
		if (services.length > 1) {
			throw new Error(
				"[TokenSetAuthRegistry] ensureAuthorizationHeader() without a key is only valid for a single ready client.",
			);
		}
		const [service] = services;
		return service ? await this._ensureAuthorizationHeaderOf(service) : null;
	}
}

/**
 * Create a new framework-neutral token-set auth registry.
 */
export function createTokenSetAuthRegistry<TClient, TService>(
	options: CreateTokenSetAuthRegistryOptions<TClient, TService>,
): TokenSetAuthRegistry<TClient, TService> {
	return new TokenSetAuthRegistry<TClient, TService>(options);
}
