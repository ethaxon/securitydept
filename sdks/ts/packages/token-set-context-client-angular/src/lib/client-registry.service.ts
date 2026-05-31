// Angular DI adapter for the core token-set client registry.

import {
	DestroyRef,
	type EnvironmentProviders,
	Injectable,
	InjectionToken,
	Injector,
	inject,
	type Provider,
	provideEnvironmentInitializer,
} from "@angular/core";
import { ENVIRONMENT } from "@securitydept/client-angular";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import {
	ClientRegistry,
	type ClientRegistryEntry,
} from "@securitydept/token-set-context-client/registry";

export const TOKEN_SET_CLIENT_REGISTRY_ENTRIES = new InjectionToken<
	readonly ClientRegistryEntry<BaseOidcModeClient>[]
>("TOKEN_SET_CLIENT_REGISTRY_ENTRIES");

/** InjectionToken for the multi-client token-set client registry. */
export const TOKEN_SET_CLIENT_REGISTRY =
	new InjectionToken<TokenSetClientRegistryService>(
		"TOKEN_SET_CLIENT_REGISTRY",
	);

@Injectable()
export class TokenSetClientRegistryService extends ClientRegistry<BaseOidcModeClient> {
	constructor(injector: Injector) {
		super({
			environment: injector.get(ENVIRONMENT),
		});
		injector.get(DestroyRef).onDestroy(() => this.dispose());
	}
}

export interface ProvideTokenSetClientRegistryOptions {
	readonly clients?: readonly ClientRegistryEntry<BaseOidcModeClient>[];
}

export function provideTokenSetClientRegistry(
	options: ProvideTokenSetClientRegistryOptions = {},
): (Provider | EnvironmentProviders)[] {
	return [
		{
			provide: TOKEN_SET_CLIENT_REGISTRY_ENTRIES,
			useValue: options.clients ?? [],
		},
		{
			provide: TokenSetClientRegistryService,
			useFactory: (injector: Injector) =>
				new TokenSetClientRegistryService(injector),
			deps: [Injector],
		},
		{
			provide: TOKEN_SET_CLIENT_REGISTRY,
			useExisting: TokenSetClientRegistryService,
		},
		provideEnvironmentInitializer(() => {
			const registry = inject(TokenSetClientRegistryService);
			const entries = inject(TOKEN_SET_CLIENT_REGISTRY_ENTRIES);
			for (const entry of entries) {
				registry.register(entry);
			}
		}),
	];
}
