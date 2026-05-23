import { DestroyRef, Injectable, inject } from "@angular/core";
import type {
	EventStreamTrait,
	FoundationEnvironment,
	ReadableReplaySignalTrait,
	ReadableSignalTrait,
} from "@securitydept/client";
import type { ClientReadinessState } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import type { TokenSetAuthEvent } from "@securitydept/token-set-context-client/orchestration";
import {
	type ClientFilter,
	type ClientKeySelector,
	type ClientMeta,
	type ClientQueryOptions,
	type TokenSetAuthRegistry as CoreTokenSetAuthRegistry,
	type TokenSetClientEntry as CoreTokenSetClientEntry,
	createTokenSetOidcAuthRegistry,
	type TokenSetAuthRegistryState,
} from "@securitydept/token-set-context-client/registry";
import type { TokenSetAngularClient, TokenSetClientEntry } from "./contracts";

// Re-export core registry types so existing adopter imports from
// @securitydept/token-set-context-client-angular keep working.
export type {
	ClientFilter,
	ClientKeySelector,
	ClientMeta,
	ClientQueryOptions,
} from "@securitydept/token-set-context-client/registry";
export { ClientInitializationPriority } from "@securitydept/token-set-context-client/registry";

// ============================================================================
// TokenSetAuthRegistry — thin Angular DI wrapper around the framework-neutral
// core at @securitydept/token-set-context-client/registry
//
// The Angular registry delegates multi-client state to a
// `createTokenSetOidcAuthRegistry()` core and
// supplies Angular-idiomatic glue:
//   - Injectable scope (root or provider-level)
//   - DestroyRef-bound dispose (envelopes `coreRegistry.dispose()`)
//   - register() wraps raw clientFactory with Angular resume reconciliation
//   - The materialized object is the mode client itself
// ============================================================================

type AngularClient = TokenSetAngularClient;

@Injectable()
export class TokenSetAuthRegistry {
	/**
	 * Shared framework-neutral registry core. Angular consumers rarely need
	 * direct access, but this is exposed so adapter-internal helpers
	 * (`CallbackResumeService`, `bearer-interceptor`) can query the core
	 * directly when they don't need Angular-specific behaviour.
	 */
	readonly core: CoreTokenSetAuthRegistry<AngularClient, AngularClient>;
	readonly authEvents: EventStreamTrait<TokenSetAuthEvent>;
	readonly state: ReadableSignalTrait<TokenSetAuthRegistryState<AngularClient>>;

	constructor() {
		this.core = createTokenSetOidcAuthRegistry<AngularClient>();
		this.authEvents = this.core.authEvents;
		this.state = this.core.state;
		// Try to bind core.dispose() to the current injection context's
		// DestroyRef. Registry is typically constructed via DI (where this
		// always succeeds); pure unit tests instantiate directly and must
		// call `.dispose()` manually.
		try {
			const destroyRef = inject(DestroyRef);
			destroyRef.onDestroy(() => this.core.dispose());
		} catch {
			// Not in an injection context — adopter is expected to call
			// registry.dispose() manually (or never, for short-lived tests).
		}
	}

	/**
	 * Register a client entry. Supports sync / async / lazy priority.
	 *
	 * The second `destroyRef` argument is no longer
	 * required — the registry pulls its own `DestroyRef` via injection and
	 * binds teardown once per Angular scope.
	 */
	register(
		entry: TokenSetClientEntry & {
			priority?: "primary" | "lazy";
			clientFactory: (
				environment: FoundationEnvironment | undefined,
			) => AngularClient;
		},
	): AngularClient;
	register(
		entry: TokenSetClientEntry & {
			priority?: "primary" | "lazy";
			clientFactory: (
				environment: FoundationEnvironment | undefined,
			) => Promise<AngularClient>;
		},
	): Promise<AngularClient>;
	register(
		entry: TokenSetClientEntry,
	): AngularClient | Promise<AngularClient> | undefined;
	register(
		entry: TokenSetClientEntry,
	): AngularClient | Promise<AngularClient> | undefined {
		return this.core.register(this.toCoreEntry(entry));
	}

	/**
	 * Manually dispose the registry. Normally bound to the ambient
	 * `DestroyRef` at construction; call this explicitly when instantiating
	 * the registry outside of an Angular injection context (e.g. in unit
	 * tests).
	 */
	dispose(): void {
		this.core.dispose();
	}

	// --------------------------------------------------------------------------
	// Pass-through API for the earlier wrapper surface
	// --------------------------------------------------------------------------

	isReady(key: string): boolean {
		return this.core.isReady(key);
	}

	readinessState(key: string): ClientReadinessState {
		return this.core.readinessState(key);
	}

	async whenReady(key?: string): Promise<AngularClient> {
		return this.core.whenReady(key);
	}

	/**
	 * Preload a lazy client without throwing on rejection. Callers are
	 * expected to attach `.catch` handlers for fire-and-forget usage.
	 */
	preload(key: string): Promise<AngularClient> {
		return this.core.preload(key);
	}

	/**
	 * Schedule preload for every lazy+not-initialized client using
	 * the core registry's explicit idle callback capability. If no idle
	 * capability was configured, this is a no-op.
	 */
	idleWarmup(): () => void {
		return this.core.idleWarmup();
	}

	has(key: string): boolean {
		return this.core.has(key);
	}

	unregister(key: string): boolean {
		return this.core.unregister(key);
	}

	resetMaterialization(key: string): boolean {
		return this.core.resetMaterialization(key);
	}

	metaFor(clientKey: string): ClientMeta | undefined {
		return this.core.metaFor(clientKey);
	}

	clientSignalFor(key?: string): ReadableReplaySignalTrait<AngularClient> {
		return this.core.clientSignalFor(key);
	}

	readyKeys(): string[] {
		return this.core.readyKeys();
	}

	registeredKeys(): string[] {
		return this.core.registeredKeys();
	}

	registeredEntriesSnapshot(): Array<[string, TokenSetClientEntry]> {
		return this.core.registeredEntriesSnapshot() as Array<
			[string, TokenSetClientEntry]
		>;
	}

	registeredMetaSnapshot(): ClientMeta[] {
		return this.core.registeredMetaSnapshot();
	}

	// ---- URL / callback / requirement / provider-family discrimination -----

	*clientKeyGenForUrl(url: string): Generator<string, void, unknown> {
		yield* this.core.clientKeyGenForUrl(url);
	}

	*clientKeyGenForCallback(url: string): Generator<string, void, unknown> {
		yield* this.core.clientKeyGenForCallback(url);
	}

	*clientKeyGenForRequirement(
		requirementKind: string,
	): Generator<string, void, unknown> {
		yield* this.core.clientKeyGenForRequirement(requirementKind);
	}

	*clientKeyGenForProviderFamily(
		providerFamily: string,
	): Generator<string, void, unknown> {
		yield* this.core.clientKeyGenForProviderFamily(providerFamily);
	}

	clientKeyListForUrl(url: string): string[] {
		return this.core.clientKeyListForUrl(url);
	}

	clientKeyListForCallback(url: string): string[] {
		return this.core.clientKeyListForCallback(url);
	}

	clientKeyListForRequirement(requirementKind: string): string[] {
		return this.core.clientKeyListForRequirement(requirementKind);
	}

	clientKeyListForProviderFamily(providerFamily: string): string[] {
		return this.core.clientKeyListForProviderFamily(providerFamily);
	}

	clientKeyForUrl(
		url: string,
		selector?: ClientKeySelector,
	): string | undefined {
		return this.core.clientKeyForUrl(url, selector);
	}

	clientKeyForCallback(
		url: string,
		selector?: ClientKeySelector,
	): string | undefined {
		return this.core.clientKeyForCallback(url, selector);
	}

	clientKeyForRequirement(
		requirementKind: string,
		selector?: ClientKeySelector,
	): string | undefined {
		return this.core.clientKeyForRequirement(requirementKind, selector);
	}

	clientKeyForProviderFamily(
		providerFamily: string,
		selector?: ClientKeySelector,
	): string | undefined {
		return this.core.clientKeyForProviderFamily(providerFamily, selector);
	}

	*clientKeyGenForFilter(
		filter: ClientFilter,
	): Generator<string, void, unknown> {
		yield* this.core.clientKeyGenForFilter(filter);
	}

	*clientKeyGenForOptions(
		options: ClientQueryOptions,
	): Generator<string, void, unknown> {
		yield* this.core.clientKeyGenForOptions(options);
	}

	clientKeysForOptions(options: ClientQueryOptions): string[] {
		return this.core.clientKeysForOptions(options);
	}

	private toCoreEntry(
		entry: TokenSetClientEntry,
	): CoreTokenSetClientEntry<AngularClient> {
		return {
			...entry,
			clientFactory: (environment) =>
				this.materializeClient(entry, environment),
		};
	}

	private materializeClient(
		entry: TokenSetClientEntry,
		environment: FoundationEnvironment | undefined,
	): AngularClient | Promise<AngularClient> {
		return entry.clientFactory(environment);
	}
}
