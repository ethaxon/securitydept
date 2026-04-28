import { DestroyRef, Injectable, inject } from "@angular/core";
import type { ClientReadinessState } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import {
	type ClientFilter,
	type ClientKeySelector,
	type ClientMeta,
	type ClientQueryOptions,
	type TokenSetAuthRegistry as CoreTokenSetAuthRegistry,
	type TokenSetClientEntry as CoreTokenSetClientEntry,
	createTokenSetAuthRegistry,
} from "@securitydept/token-set-context-client/registry";
import type { TokenSetAngularClient, TokenSetClientEntry } from "./contracts";
import { TokenSetAuthService } from "./token-set-auth.service";

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
// Iteration 110: the Angular registry used to own all multi-client state
// directly. It now delegates to a `createTokenSetAuthRegistry()` core and
// supplies Angular-idiomatic glue:
//   - Injectable scope (root or provider-level)
//   - DestroyRef-bound dispose (envelopes `coreRegistry.dispose()`)
//   - Materialize callback wraps raw clients in `TokenSetAuthService`
//   - access-token sugar routed through the service's signal
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
	readonly core: CoreTokenSetAuthRegistry<AngularClient, TokenSetAuthService>;

	constructor() {
		this.core = createTokenSetAuthRegistry<AngularClient, TokenSetAuthService>({
			materialize: (client, entry) =>
				new TokenSetAuthService(client, entry.autoRestore ?? true),
			dispose: (service) => service.dispose(),
			accessTokenOf: (service) => service.accessToken(),
			ensureAccessTokenOf: (service) => service.ensureAccessToken(),
			ensureAuthorizationHeaderOf: (service) =>
				service.ensureAuthorizationHeader(),
		});
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
	 * Iteration 110 change: the second `destroyRef` argument is no longer
	 * required — the registry pulls its own `DestroyRef` via injection and
	 * binds teardown once per Angular scope.
	 */
	register(
		entry: TokenSetClientEntry & {
			priority?: "primary" | "lazy";
			clientFactory: () => AngularClient;
		},
	): TokenSetAuthService;
	register(
		entry: TokenSetClientEntry & {
			priority?: "primary" | "lazy";
			clientFactory: () => Promise<AngularClient>;
		},
	): Promise<TokenSetAuthService>;
	register(
		entry: TokenSetClientEntry,
	): TokenSetAuthService | Promise<TokenSetAuthService> | undefined;
	register(
		entry: TokenSetClientEntry,
	): TokenSetAuthService | Promise<TokenSetAuthService> | undefined {
		return this.core.register(entry as CoreTokenSetClientEntry<AngularClient>);
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
	// Pass-through API (backwards-compatible with iteration 109 surface)
	// --------------------------------------------------------------------------

	isReady(key: string): boolean {
		return this.core.isReady(key);
	}

	readinessState(key: string): ClientReadinessState {
		return this.core.readinessState(key);
	}

	async whenReady(key: string): Promise<TokenSetAuthService> {
		return this.core.whenReady(key);
	}

	/**
	 * Preload a lazy client without throwing on rejection. Callers are
	 * expected to attach `.catch` handlers for fire-and-forget usage.
	 */
	preload(key: string): Promise<TokenSetAuthService> {
		return this.core.preload(key);
	}

	/**
	 * Schedule preload for every lazy+not-initialized client using
	 * `requestIdleCallback` / `setTimeout` fallback.
	 */
	idleWarmup(): () => void {
		return this.core.idleWarmup();
	}

	reset(key: string): void {
		this.core.reset(key);
	}

	metaFor(clientKey: string): ClientMeta | undefined {
		return this.core.metaFor(clientKey);
	}

	get(key: string): TokenSetAuthService | undefined {
		return this.core.get(key);
	}

	require(key: string): TokenSetAuthService {
		return this.core.require(key);
	}

	keys(): string[] {
		return this.core.keys();
	}

	entries(): Array<[string, TokenSetAuthService]> {
		return this.core.entriesSnapshot();
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

	requireForRequirement(
		requirementKind: string,
		selector?: ClientKeySelector,
	): TokenSetAuthService {
		return this.core.requireForRequirement(requirementKind, selector);
	}

	requireForProviderFamily(
		providerFamily: string,
		selector?: ClientKeySelector,
	): TokenSetAuthService {
		return this.core.requireForProviderFamily(providerFamily, selector);
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

	accessToken(key?: string): string | null {
		return this.core.accessToken(key);
	}

	async ensureAccessToken(key?: string): Promise<string | null> {
		return await this.core.ensureAccessToken(key);
	}

	async ensureAuthorizationHeader(key?: string): Promise<string | null> {
		return await this.core.ensureAuthorizationHeader(key);
	}
}
