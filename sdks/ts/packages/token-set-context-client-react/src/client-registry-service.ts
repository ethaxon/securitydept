// React DI adapter for the core token-set client registry.

import {
	ENVIRONMENT_TOKEN,
	INJECTOR_TOKEN,
	SecuritydeptDestroyRef,
	SecuritydeptInjectionToken,
	type SecuritydeptInjector,
	type SecuritydeptProvider,
} from "@securitydept/client";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import {
	TokenSetClientRegistry,
	type TokenSetClientRegistryEntry,
} from "@securitydept/token-set-context-client/registry";

export const TOKEN_SET_CLIENT_REGISTRY_ENTRIES = new SecuritydeptInjectionToken<
	readonly TokenSetClientRegistryEntry<BaseOidcModeClient>[]
>("TOKEN_SET_CLIENT_REGISTRY_ENTRIES");

export const TOKEN_SET_CLIENT_REGISTRY =
	new SecuritydeptInjectionToken<TokenSetClientRegistryService>(
		"TOKEN_SET_CLIENT_REGISTRY",
	);

export class TokenSetClientRegistryService extends TokenSetClientRegistry<BaseOidcModeClient> {
	constructor(injector: SecuritydeptInjector) {
		super({
			environment: injector.get(ENVIRONMENT_TOKEN),
		});

		for (const entry of injector.get(TOKEN_SET_CLIENT_REGISTRY_ENTRIES, [])) {
			this.register(entry);
		}

		injector.get(SecuritydeptDestroyRef, null)?.onDestroy(() => this.dispose());
	}
}

export interface ProvideTokenSetClientRegistryOptions {
	readonly clients?: readonly TokenSetClientRegistryEntry<BaseOidcModeClient>[];
}

export function provideTokenSetClientRegistry(
	options: ProvideTokenSetClientRegistryOptions = {},
): readonly SecuritydeptProvider[] {
	return [
		{
			provide: TOKEN_SET_CLIENT_REGISTRY_ENTRIES,
			useValue: options.clients ?? [],
		},
		{
			provide: TokenSetClientRegistryService,
			useFactory: (injector: SecuritydeptInjector) =>
				new TokenSetClientRegistryService(injector),
			deps: [INJECTOR_TOKEN],
		},
		{
			provide: TOKEN_SET_CLIENT_REGISTRY,
			useExisting: TokenSetClientRegistryService,
		},
	];
}
