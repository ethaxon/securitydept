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

import {
	createEventSubject,
	createReplaySignal,
	createSignal,
	type EventStreamTrait,
	type EventSubscriptionTrait,
	type FoundationEnvironment,
	type ReadableReplaySignalTrait,
	type ReadableSignalTrait,
	readonlyReplaySignal,
	readonlySignal,
	type WritableReplaySignalTrait,
} from "@securitydept/client";
import { ClientReadinessState } from "../../frontend-oidc-mode/config/config-source";
import {
	type TokenSetAuthEvent,
	type TokenSetAuthEventType,
} from "../../orchestration";
import {
	type ClientFilter,
	ClientInitializationPriority,
	type ClientKeySelector,
	type ClientMeta,
	type ClientQueryOptions,
	type CreateTokenSetAuthRegistryOptions,
	type CreateTokenSetOidcAuthRegistryOptions,
	type OidcModeClient,
	type TokenSetAuthRegistryEntryState,
	type TokenSetAuthRegistryEvent,
	TokenSetAuthRegistryLifecycleError,
	TokenSetAuthRegistryLifecycleErrorCode,
	type TokenSetAuthRegistryState,
	type TokenSetClientEntry,
} from "../contracts/types";
import { isOidcCallback } from "./oidc-callback-url";

// ---------------------------------------------------------------------------
// Pending registration — tracks async clientFactory lifecycle
// ---------------------------------------------------------------------------

interface PendingRegistration<TService> {
	readonly promise: Promise<TService>;
	state: ClientReadinessState;
	invalidationError?: TokenSetAuthRegistryLifecycleError;
}

interface RegistrationRecord<TClient> {
	entry: TokenSetClientEntry<TClient>;
	generation: number;
}

// ---------------------------------------------------------------------------
// Framework-neutral registry class
// ---------------------------------------------------------------------------

/**
 * Framework-neutral multi-client token-set auth registry.
 *
 * Instantiated by framework adapters (Angular's `TokenSetAuthRegistry` DI
 * wrapper, React's provider-scoped token-set runtime factories). The adapter supplies a
 * `materialize` callback when it needs a custom materialized object. The
 * default OIDC wiring stores the mode client itself.
 *
 * ## Lifecycle states (per key)
 *
 * ```
 *   register()  ─┬──> not_initialized  (priority=lazy, not preloaded)
 *                ├──> initializing     (clientFactory returned a Promise)
 *                ├──> ready            (materialization succeeded)
 *                └──> failed           (materialization rejected)
 *
 *   preload(key) / whenReady(key?) / idleWarmup()
 *                 trigger transitions from not_initialized → initializing
 * ```
 *
 * ## Priority model
 *
 * - `priority: "primary"` (default): clientFactory runs eagerly at
 *   `register()` time (matching the eager registration model).
 * - `priority: "lazy"`: the entry is recorded, metadata is indexed, but
 *   `clientFactory` does **not** run until `preload(key)` /
 *   `whenReady(key?)` / `idleWarmup()` is called.
 *
 * ## Thread-safety
 *
 * The registry is single-threaded (JS event loop). Concurrent
 * `whenReady(key?)` / `preload(key)` calls during `initializing` state
 * return the same pending promise.
 */
export class TokenSetAuthRegistry<TClient, TService> {
	private readonly materialize: (
		client: TClient,
		entry: TokenSetClientEntry<TClient>,
	) => TService;
	private readonly _dispose: (service: TService) => void;
	private readonly _start: (
		client: TClient,
		service: TService,
		entry: TokenSetClientEntry<TClient>,
	) => Promise<void> | void;
	private readonly _authEventsOf: (
		service: TService,
	) => EventStreamTrait<TokenSetAuthEvent>;
	private readonly environment: FoundationEnvironment | undefined;
	private readonly authEventSubject =
		createEventSubject<TokenSetAuthRegistryEvent>();
	readonly authEvents: EventStreamTrait<TokenSetAuthRegistryEvent> =
		this.authEventSubject;
	private readonly stateSignal = createSignal<
		TokenSetAuthRegistryState<TClient>
	>({
		entries: [],
		registeredKeys: [],
		readyKeys: [],
	});
	readonly state: ReadableSignalTrait<TokenSetAuthRegistryState<TClient>>;

	// Materialized objects (after clientFactory resolves).
	private readonly services = new Map<string, TService>();
	// Raw registration entries (kept so we can re-run clientFactory for lazy
	// clients and reset()).
	private readonly entries = new Map<string, RegistrationRecord<TClient>>();
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
	private readonly authEventSubscriptions = new Map<
		string,
		EventSubscriptionTrait
	>();
	private readonly lifecycleErrors = new Map<string, unknown | null>();
	private readonly failedMaterializations = new Map<string, unknown>();
	private readonly clientSignals = new Map<
		string,
		WritableReplaySignalTrait<TService>
	>();
	private generationCounter = 0;

	constructor(options: CreateTokenSetAuthRegistryOptions<TClient, TService>) {
		this.materialize = options.materialize;
		this._dispose = options.dispose;
		this._start = options.start ?? (() => undefined);
		this._authEventsOf = options.authEventsOf;
		this.environment = options.environment;
		this.state = readonlySignal(this.stateSignal);
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
	 *   Call `whenReady(key?)` / `preload(key)` to materialize later.
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
		const record: RegistrationRecord<TClient> = {
			entry,
			generation: this.nextGeneration(),
		};
		this.entries.set(entry.key, record);
		this.indexMeta(entry);
		this.lifecycleErrors.set(entry.key, null);
		this.failedMaterializations.delete(entry.key);

		const priority = entry.priority ?? ClientInitializationPriority.Primary;
		if (priority === ClientInitializationPriority.Lazy) {
			// Lazy: defer materialization until asked.
			this.refreshState();
			return undefined;
		}
		return this.materializeEntry(record);
	}

	private nextGeneration(): number {
		this.generationCounter += 1;
		return this.generationCounter;
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
		record: RegistrationRecord<TClient>,
	): TService | Promise<TService> {
		const entry = record.entry;
		// If materialization is already in flight or complete, return existing.
		const existing = this.services.get(entry.key);
		if (existing !== undefined) return existing;
		const pending = this.pendingRegistrations.get(entry.key);
		if (pending) return pending.promise;
		this.failedMaterializations.delete(entry.key);
		this.lifecycleErrors.set(entry.key, null);

		let clientOrPromise: TClient | Promise<TClient>;
		try {
			clientOrPromise = entry.clientFactory(this.environment);
		} catch (error) {
			this.recordFailedMaterialization(entry.key, error);
			throw error;
		}

		if (clientOrPromise instanceof Promise) {
			let pendingEntry!: PendingRegistration<TService>;
			const promise = clientOrPromise.then(
				async (client) => {
					try {
						return await this.materializeAndStartCurrentRecord(
							client,
							record,
							pendingEntry,
						);
					} catch (error) {
						if (!pendingEntry.invalidationError) {
							pendingEntry.state = ClientReadinessState.Failed;
							this.lifecycleErrors.set(entry.key, error);
							this.failedMaterializations.set(entry.key, error);
							this.refreshState();
						}
						throw error;
					}
				},
				(error) => {
					if (pendingEntry.invalidationError) {
						throw pendingEntry.invalidationError;
					}
					pendingEntry.state = ClientReadinessState.Failed;
					this.lifecycleErrors.set(entry.key, error);
					this.failedMaterializations.set(entry.key, error);
					this.refreshState();
					throw error;
				},
			);
			pendingEntry = {
				promise,
				state: ClientReadinessState.Initializing,
			};
			this.pendingRegistrations.set(entry.key, pendingEntry);
			this.refreshState();
			return promise;
		}

		let service: TService | undefined;
		try {
			service = this.materializeCurrentRecord(clientOrPromise, record);
			const started = this.startCurrentRecord(clientOrPromise, service, record);
			if (started instanceof Promise) {
				const readyService = service;
				let pendingEntry!: PendingRegistration<TService>;
				const promise = started
					.then(() =>
						this.markCurrentRecordReady(
							record.entry.key,
							readyService,
							record,
							pendingEntry,
						),
					)
					.catch((error) => {
						this.disposeService(readyService);
						if (!pendingEntry.invalidationError) {
							pendingEntry.state = ClientReadinessState.Failed;
							this.lifecycleErrors.set(entry.key, error);
							this.failedMaterializations.set(entry.key, error);
							this.refreshState();
						}
						throw pendingEntry.invalidationError ?? error;
					});
				pendingEntry = {
					promise,
					state: ClientReadinessState.Initializing,
				};
				this.pendingRegistrations.set(entry.key, pendingEntry);
				this.refreshState();
				return promise;
			}
			return this.markCurrentRecordReady(record.entry.key, service, record);
		} catch (error) {
			if (service !== undefined) {
				this.disposeService(service);
			}
			this.recordFailedMaterialization(entry.key, error);
			throw error;
		}
	}

	private recordFailedMaterialization(key: string, error: unknown): void {
		this.failedMaterializations.set(key, error);
		this.lifecycleErrors.set(key, error);
		this.refreshState();
	}

	private materializeCurrentRecord(
		client: TClient,
		record: RegistrationRecord<TClient>,
		pending?: PendingRegistration<TService>,
	): TService {
		const staleError = this.resolveStaleLifecycleError(
			record.entry.key,
			record,
			pending,
		);
		if (staleError) {
			throw staleError;
		}

		const service = this.materialize(client, record.entry);
		const postMaterializeStaleError = this.resolveStaleLifecycleError(
			record.entry.key,
			record,
			pending,
		);
		if (postMaterializeStaleError) {
			this.disposeService(service);
			throw postMaterializeStaleError;
		}

		return service;
	}

	private async materializeAndStartCurrentRecord(
		client: TClient,
		record: RegistrationRecord<TClient>,
		pending: PendingRegistration<TService>,
	): Promise<TService> {
		const service = this.materializeCurrentRecord(client, record, pending);
		try {
			await this.startCurrentRecord(client, service, record, pending);
			return this.markCurrentRecordReady(
				record.entry.key,
				service,
				record,
				pending,
			);
		} catch (error) {
			this.disposeService(service);
			throw error;
		}
	}

	private startCurrentRecord(
		client: TClient,
		service: TService,
		record: RegistrationRecord<TClient>,
		pending?: PendingRegistration<TService>,
	): Promise<void> | void {
		const staleError = this.resolveStaleLifecycleError(
			record.entry.key,
			record,
			pending,
		);
		if (staleError) {
			throw staleError;
		}
		return this._start(client, service, record.entry);
	}

	private markCurrentRecordReady(
		key: string,
		service: TService,
		record: RegistrationRecord<TClient>,
		pending?: PendingRegistration<TService>,
	): TService {
		const staleError = this.resolveStaleLifecycleError(key, record, pending);
		if (staleError) {
			this.disposeService(service);
			throw staleError;
		}

		this.pendingRegistrations.delete(key);
		this.services.set(key, service);
		this.attachAuthEvents(key, service);
		this.clientSignalForExistingKey(key).setValue(service);
		if (pending) {
			pending.state = ClientReadinessState.Ready;
		}
		this.lifecycleErrors.set(key, null);
		this.failedMaterializations.delete(key);
		this.refreshState();
		return service;
	}

	private resolveStaleLifecycleError(
		key: string,
		record: RegistrationRecord<TClient>,
		pending?: PendingRegistration<TService>,
	): TokenSetAuthRegistryLifecycleError | undefined {
		if (pending?.invalidationError) {
			return pending.invalidationError;
		}

		const currentRecord = this.entries.get(key);
		if (
			!currentRecord ||
			currentRecord !== record ||
			currentRecord.generation !== record.generation ||
			currentRecord.entry !== record.entry
		) {
			return this.createLifecycleError(
				TokenSetAuthRegistryLifecycleErrorCode.ClientUnregistered,
				key,
			);
		}

		if (pending) {
			const currentPending = this.pendingRegistrations.get(key);
			if (currentPending !== pending) {
				return (
					pending.invalidationError ??
					this.createLifecycleError(
						TokenSetAuthRegistryLifecycleErrorCode.MaterializationReset,
						key,
					)
				);
			}
		}

		return undefined;
	}

	// -------------------------------------------------------------------
	// Readiness API
	// -------------------------------------------------------------------

	/** True when `whenReady(key)` can return a started service immediately. */
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
	 *   `unregister(key)` then register again to retry)
	 */
	readinessState(key: string): ClientReadinessState {
		return (
			this.state.get().entries.find((entry) => entry.key === key)?.readiness ??
			ClientReadinessState.NotInitialized
		);
	}

	/**
	 * Await materialization for a key. When `key` is omitted, exactly one
	 * registered client must exist. Triggers materialization if the resolved
	 * key was registered lazy and hasn't been preloaded yet. Rejects if the
	 * key is unregistered or the factory fails.
	 */
	async whenReady(key?: string): Promise<TService> {
		const resolvedKey = this.resolveRegisteredKeyForSingleClientOperation(
			key,
			"whenReady",
		);

		const existing = this.services.get(resolvedKey);
		if (existing) return existing;

		const pending = this.pendingRegistrations.get(resolvedKey);
		if (pending) return pending.promise;

		if (this.failedMaterializations.has(resolvedKey)) {
			throw this.failedMaterializations.get(resolvedKey);
		}

		const record = this.entries.get(resolvedKey);
		if (!record) {
			throw new Error(
				`[TokenSetAuthRegistry] No client registered for key "${resolvedKey}". ` +
					`Available keys: ${[...this.entries.keys()].join(", ")}`,
			);
		}

		// Lazy client that hasn't been materialized yet — kick it off now.
		const result = this.materializeEntry(record);
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
	 * Requires an explicit idle-callback capability. Returns a cancel function
	 * that aborts pending (not-yet-fired) warmups.
	 */
	idleWarmup(): () => void {
		const idleCallback = this.environment?.idleCallback;
		if (!idleCallback) {
			return () => {};
		}
		const cancels: Array<() => void> = [];
		for (const [key, record] of this.entries) {
			if (
				(record.entry.priority ?? ClientInitializationPriority.Primary) !==
				ClientInitializationPriority.Lazy
			) {
				continue;
			}
			if (this.readinessState(key) !== ClientReadinessState.NotInitialized) {
				continue;
			}
			const handle = idleCallback.requestIdleCallback(() => {
				this.preload(key).catch(() => {
					// Swallow: callers who care use whenReady() instead.
				});
			});
			cancels.push(() => idleCallback.cancelIdleCallback(handle));
		}
		return () => {
			for (const cancel of cancels) cancel();
		};
	}

	/**
	 * Drop a registered client entirely. Disposes the materialized service
	 * (if any), clears readiness state, and removes metadata.
	 */
	unregister(key: string): boolean {
		const record = this.entries.get(key);
		if (!record) return false;

		this.invalidatePending(
			key,
			this.createLifecycleError(
				TokenSetAuthRegistryLifecycleErrorCode.ClientUnregistered,
				key,
			),
		);
		this.clearReadyService(key);
		this.failedMaterializations.delete(key);
		this.lifecycleErrors.delete(key);
		this.clearClientSignal(key, { deleteSignal: true });
		this.entries.delete(key);
		this.metas.delete(key);
		this.callbackPaths.delete(key);
		for (let i = this.urlRules.length - 1; i >= 0; i--) {
			if (this.urlRules[i].key === key) {
				this.urlRules.splice(i, 1);
			}
		}
		for (const [kind, keys] of this.requirementKindMap) {
			const filtered = keys.filter((entryKey) => entryKey !== key);
			if (filtered.length === 0) {
				this.requirementKindMap.delete(kind);
			} else {
				this.requirementKindMap.set(kind, filtered);
			}
		}
		for (const [family, keys] of this.providerFamilyMap) {
			const filtered = keys.filter((entryKey) => entryKey !== key);
			if (filtered.length === 0) {
				this.providerFamilyMap.delete(family);
			} else {
				this.providerFamilyMap.set(family, filtered);
			}
		}
		this.refreshState();
		return true;
	}

	resetMaterialization(key: string): boolean {
		const record = this.entries.get(key);
		if (!record) return false;

		record.generation = this.nextGeneration();
		this.invalidatePending(
			key,
			this.createLifecycleError(
				TokenSetAuthRegistryLifecycleErrorCode.MaterializationReset,
				key,
			),
		);
		this.clearReadyService(key);
		this.failedMaterializations.delete(key);
		this.lifecycleErrors.set(key, null);
		this.clearClientSignal(key, { deleteSignal: false });
		this.refreshState();
		return true;
	}

	private invalidatePending(
		key: string,
		error: TokenSetAuthRegistryLifecycleError,
	): void {
		const pending = this.pendingRegistrations.get(key);
		if (!pending) return;
		pending.invalidationError = error;
		this.pendingRegistrations.delete(key);
	}

	private clearReadyService(key: string): void {
		const service = this.services.get(key);
		this.services.delete(key);
		this.detachAuthEvents(key);
		if (service !== undefined) {
			this.disposeService(service);
		}
	}

	private clearClientSignal(
		key: string,
		options: { deleteSignal: boolean },
	): void {
		if (options.deleteSignal) {
			this.clientSignals.delete(key);
			return;
		}
		this.clientSignals.set(key, createReplaySignal<TService>());
	}

	private refreshState(): void {
		const entries: TokenSetAuthRegistryEntryState<TClient>[] = [];
		const registeredKeys: string[] = [];
		const readyKeys: string[] = [];

		for (const [key, record] of this.entries) {
			const readiness = this.resolveEntryReadiness(key);
			if (readiness === ClientReadinessState.Ready) {
				readyKeys.push(key);
			}
			registeredKeys.push(key);
			entries.push({
				key,
				entry: this.snapshotEntry(record.entry),
				meta: this.snapshotMeta(
					this.metas.get(key) ?? this.metaFromEntry(record.entry),
				),
				readiness,
				generation: record.generation,
				lifecycleError: this.lifecycleErrors.get(key) ?? null,
			});
		}

		this.stateSignal.set({
			entries,
			registeredKeys,
			readyKeys,
		});
	}

	private resolveEntryReadiness(key: string): ClientReadinessState {
		if (this.services.has(key)) {
			return ClientReadinessState.Ready;
		}
		const pending = this.pendingRegistrations.get(key);
		if (pending) {
			return pending.state;
		}
		if (this.failedMaterializations.has(key)) {
			return ClientReadinessState.Failed;
		}
		return ClientReadinessState.NotInitialized;
	}

	private metaFromEntry(entry: TokenSetClientEntry<TClient>): ClientMeta {
		return {
			clientKey: entry.key,
			urlPatterns: [...(entry.urlPatterns ?? [])],
			callbackPath: entry.callbackPath,
			requirementKind: entry.requirementKind,
			providerFamily: entry.providerFamily,
			priority: entry.priority ?? ClientInitializationPriority.Primary,
		};
	}

	private disposeService(service: TService): void {
		try {
			this._dispose(service);
		} catch {
			// Swallow; dispose is best-effort.
		}
	}

	private createLifecycleError(
		code: TokenSetAuthRegistryLifecycleErrorCode,
		clientKey: string,
	): TokenSetAuthRegistryLifecycleError {
		return new TokenSetAuthRegistryLifecycleError({ code, clientKey });
	}

	/**
	 * Dispose all materialized services and clear all state.
	 *
	 * Called by adapters at framework teardown (Angular `DestroyRef`,
	 * React `useEffect` cleanup).
	 */
	dispose(): void {
		for (const key of [...this.entries.keys()]) {
			this.unregister(key);
		}
	}

	// -------------------------------------------------------------------
	// Lookup API
	// -------------------------------------------------------------------

	clientSignalFor(key?: string): ReadableReplaySignalTrait<TService> {
		const resolvedKey = this.resolveRegisteredKeyForSingleClientOperation(
			key,
			"clientSignalFor",
		);
		const signal = this.clientSignalForExistingKey(resolvedKey);
		this.whenReady(resolvedKey).catch(() => {
			// Failure is reflected through registry readiness/lifecycleError.
		});
		return readonlyReplaySignal(signal);
	}

	private clientSignalForExistingKey(
		key: string,
	): WritableReplaySignalTrait<TService> {
		let signal = this.clientSignals.get(key);
		if (!signal) {
			signal = createReplaySignal<TService>();
			this.clientSignals.set(key, signal);
		}
		return signal;
	}

	has(key: string): boolean {
		return this.entries.has(key);
	}

	readyKeys(): string[] {
		return [...this.state.get().readyKeys];
	}

	registeredKeys(): string[] {
		return [...this.state.get().registeredKeys];
	}

	registeredEntriesSnapshot(): Array<[string, TokenSetClientEntry<TClient>]> {
		return this.state
			.get()
			.entries.map((entry) => [entry.key, this.snapshotEntry(entry.entry)]);
	}

	registeredMetaSnapshot(): ClientMeta[] {
		return this.state
			.get()
			.entries.map((entry) => this.snapshotMeta(entry.meta));
	}

	metaFor(clientKey: string): ClientMeta | undefined {
		const entry = this.state
			.get()
			.entries.find((stateEntry) => stateEntry.key === clientKey);
		return entry ? this.snapshotMeta(entry.meta) : undefined;
	}

	private snapshotEntry(
		entry: TokenSetClientEntry<TClient>,
	): TokenSetClientEntry<TClient> {
		return {
			...entry,
			urlPatterns: entry.urlPatterns ? [...entry.urlPatterns] : undefined,
		};
	}

	private snapshotMeta(meta: ClientMeta): ClientMeta {
		return {
			...meta,
			urlPatterns: [...meta.urlPatterns],
		};
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

	private resolveRegisteredKeyForSingleClientOperation(
		key: string | undefined,
		methodName: string,
	): string {
		if (key !== undefined) return key;

		const keys = [...this.entries.keys()];
		if (keys.length === 0) {
			throw new Error(
				`[TokenSetAuthRegistry] ${methodName}() without a key requires one registered client, but no clients are registered.`,
			);
		}
		if (keys.length > 1) {
			throw new Error(
				`[TokenSetAuthRegistry] ${methodName}() without a key is only valid for a single registered client.`,
			);
		}
		const [resolvedKey] = keys;
		return resolvedKey;
	}

	private attachAuthEvents(key: string, service: TService): void {
		this.detachAuthEvents(key);
		const stream = this.authEventsOf(service);
		if (!stream) return;

		this.authEventSubscriptions.set(
			key,
			stream.subscribe({
				next: (event) => {
					this.authEventSubject.next(this.aggregateAuthEvent(key, event));
				},
			}),
		);
	}

	private detachAuthEvents(key: string): void {
		this.authEventSubscriptions.get(key)?.unsubscribe();
		this.authEventSubscriptions.delete(key);
	}

	private authEventsOf(service: TService): EventStreamTrait<TokenSetAuthEvent> {
		return this._authEventsOf(service);
	}

	private aggregateAuthEvent<TType extends TokenSetAuthEventType>(
		key: string,
		event: TokenSetAuthEvent<TType>,
	): TokenSetAuthRegistryEvent<TType> {
		return {
			...event,
			payload: {
				...event.payload,
				id: event.payload.id ?? key,
			},
		} as TokenSetAuthRegistryEvent<TType>;
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
export function createTokenSetOidcAuthRegistry<TClient extends OidcModeClient>(
	options: CreateTokenSetOidcAuthRegistryOptions = {},
): TokenSetAuthRegistry<TClient, TClient> {
	return createTokenSetAuthRegistry<TClient, TClient>({
		materialize: materializeOidcClient,
		dispose: disposeOidcClient,
		start: startOidcClient,
		authEventsOf: authEventsOfOidcClient,
		environment: options.environment,
	});
}

function materializeOidcClient<TClient extends OidcModeClient>(
	client: TClient,
	_entry: TokenSetClientEntry<TClient>,
): TClient {
	return client;
}

async function startOidcClient<TClient extends OidcModeClient>(
	client: TClient,
): Promise<void> {
	await client.start();
}

function disposeOidcClient<TClient extends OidcModeClient>(
	client: TClient,
): void {
	client.dispose();
}

function authEventsOfOidcClient<TClient extends OidcModeClient>(
	client: TClient,
): EventStreamTrait<TokenSetAuthEvent> {
	return client.authEvents;
}
