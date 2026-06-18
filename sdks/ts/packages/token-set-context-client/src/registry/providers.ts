import {
	INJECTOR_TOKEN,
	type SecuritydeptDependencyDescriptor,
	type SecuritydeptInjectorTrait,
	type SecuritydeptProvider,
} from "@securitydept/client";
import { type BaseOidcModeClient } from "../orchestration/client/base-client";
import {
	TOKEN_SET_CLIENT_REGISTRY,
	TOKEN_SET_CLIENT_REGISTRY_ENTRIES,
} from "./contracts/tokens";
import { type TokenSetClientRegistryEntry } from "./contracts/types";
import { TokenSetClientRegistry } from "./core/client-registry";

type TokenSetClientRegistryFactoryDependencies<
	TDependencies extends readonly unknown[],
> = {
	readonly [TIndex in keyof TDependencies]: SecuritydeptDependencyDescriptor<
		TDependencies[TIndex]
	>;
};

export type ProvideTokenSetClientRegistryOptions<
	TDependencies extends readonly unknown[] = readonly [],
> =
	| {
			readonly clients?: readonly TokenSetClientRegistryEntry<BaseOidcModeClient>[];
			readonly createClients?: never;
			readonly dependencies?: never;
	  }
	| {
			readonly clients?: never;
			readonly createClients: (
				injector: SecuritydeptInjectorTrait,
				...dependencies: TDependencies
			) => readonly TokenSetClientRegistryEntry<BaseOidcModeClient>[];
			readonly dependencies?: TokenSetClientRegistryFactoryDependencies<TDependencies>;
	  };

export function provideTokenSetClientRegistry<
	TDependencies extends readonly unknown[] = readonly [],
>(
	options: ProvideTokenSetClientRegistryOptions<TDependencies> = {},
): readonly SecuritydeptProvider[] {
	return [
		options.createClients
			? {
					provide: TOKEN_SET_CLIENT_REGISTRY_ENTRIES,
					useFactory: (
						injector: SecuritydeptInjectorTrait,
						...dependencies: TDependencies
					) => options.createClients(injector, ...dependencies),
					deps: [INJECTOR_TOKEN, ...(options.dependencies ?? [])],
				}
			: {
					provide: TOKEN_SET_CLIENT_REGISTRY_ENTRIES,
					useValue: options.clients ?? [],
				},
		{
			provide: TOKEN_SET_CLIENT_REGISTRY,
			useFactory: (injector: SecuritydeptInjectorTrait) =>
				TokenSetClientRegistry.fromInjector(injector),
			deps: [INJECTOR_TOKEN],
		},
	];
}
