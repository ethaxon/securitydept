import { DestroyRef, Injectable, inject } from "@angular/core";
import {
	type EventStreamTrait,
	type ReadableReplaySignalTrait,
	type ReadableSignalTrait,
} from "@securitydept/client";
import {
	ClientInitializationMode,
	type ClientQueryOptions,
	type ClientRecord,
	type ClientRecordView,
	type ClientRegistryEvent,
	type ClientRegistry as CoreClientRegistry,
	type ClientRegistryEntry as CoreClientRegistryEntry,
	createClientRegistry,
} from "@securitydept/token-set-context-client/registry";
import {
	type TokenSetAngularClient,
	type TokenSetClientEntry,
} from "./contracts";

// Re-export core registry types so existing adopter imports from
// @securitydept/token-set-context-client-angular keep working.
export type {
	ClientFilter,
	ClientMeta,
	ClientQueryOptions,
	ClientSelector,
} from "@securitydept/token-set-context-client/registry";
export { ClientInitializationMode } from "@securitydept/token-set-context-client/registry";

// ============================================================================
// TokenSetAuthRegistry — thin Angular DI wrapper around the framework-neutral
// ClientRegistry core at @securitydept/token-set-context-client/registry.
//
// The Angular registry delegates client lifecycle state to ClientRegistry and
// supplies Angular-idiomatic glue:
//   - Injectable scope (root or provider-level)
//   - DestroyRef-bound dispose
//   - TokenSetAngularClient registration helpers
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
	readonly core: CoreClientRegistry<AngularClient>;
	readonly events: EventStreamTrait<ClientRegistryEvent<AngularClient>>;
	readonly entries: ReadableSignalTrait<
		readonly ClientRecordView<AngularClient>[]
	>;

	constructor() {
		this.core = createClientRegistry<AngularClient>({
			environment: {},
		});
		this.events = this.core.events;
		this.entries = this.core.entries;
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
	register(entry: TokenSetClientEntry): void {
		this.core.register(this.toCoreEntry(entry));
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

	async initialize(key: string): Promise<AngularClient> {
		return this.core.initialize(key);
	}

	has(key: string): boolean {
		return this.core.has(key);
	}

	unregister(key: string): boolean {
		return this.core.unregister(key);
	}

	clientSignalFor(key: string): ReadableReplaySignalTrait<AngularClient> {
		return this.core.clientSignalFor(key);
	}

	clientRecordFor(
		key: string,
	): ReadableSignalTrait<ClientRecord<AngularClient>> {
		return this.core.clientRecordFor(key);
	}

	clientRecordOptionFor(
		key: string,
	): ReadableSignalTrait<ClientRecord<AngularClient>> | undefined {
		return this.core.clientRecordOptionFor(key);
	}

	// ---- URL / callback / requirement / provider-family discrimination -----

	*clientRecordGenForQuery(
		query: ClientQueryOptions,
	): Generator<
		ReadableSignalTrait<ClientRecord<AngularClient>>,
		void,
		unknown
	> {
		yield* this.core.clientRecordGenForQuery(query);
	}

	clientRecordForQuery(
		query: ClientQueryOptions,
	): ReadableSignalTrait<ClientRecord<AngularClient>> | undefined {
		return this.core.clientRecordForQuery(query);
	}

	*clientSignalGenForQuery(
		query: ClientQueryOptions,
	): Generator<ReadableReplaySignalTrait<AngularClient>, void, unknown> {
		yield* this.core.clientSignalGenForQuery(query);
	}

	clientSignalForQuery(
		query: ClientQueryOptions,
	): ReadableReplaySignalTrait<AngularClient> | undefined {
		return this.core.clientSignalForQuery(query);
	}

	private toCoreEntry(
		entry: TokenSetClientEntry,
	): CoreClientRegistryEntry<AngularClient> {
		return {
			clientFactory: () => this.materializeClient(entry),
			meta: {
				clientKey: entry.key,
				urlPatterns: entry.urlPatterns ?? [],
				callbackPath: entry.callbackPath,
				requirementKind: entry.requirementKind,
				providerFamily: entry.providerFamily,
				initialization:
					entry.initialization ?? ClientInitializationMode.Immediate,
			},
		};
	}

	private materializeClient(
		entry: TokenSetClientEntry,
	): AngularClient | Promise<AngularClient> {
		return entry.clientFactory();
	}
}
