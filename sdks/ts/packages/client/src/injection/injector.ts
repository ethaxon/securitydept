import {
	ReflectiveInjector,
	InjectionToken as RuntimeInjectionToken,
	Injector as RuntimeInjector,
	type Provider as RuntimeProvider,
} from "injection-js";
import {
	type SecuritydeptAbstractType,
	type SecuritydeptDependencyToken,
	type SecuritydeptFactoryProvider,
	SecuritydeptInjectionToken,
	type SecuritydeptInjectorTrait,
	type SecuritydeptProvider,
} from "./types";

interface NormalizedProviders {
	providers: RuntimeProvider[];
}

type RuntimeProviderToken<T> =
	| RuntimeInjectionToken<T>
	| SecuritydeptAbstractType<T>;

export class SecuritydeptInjector implements SecuritydeptInjectorTrait {
	static resolveAndCreate(
		providers: readonly SecuritydeptProvider[],
	): SecuritydeptInjector {
		const normalized = normalizeProviders([
			...providers,
			createInjectorSelfProvider(),
		]);
		return getSecuritydeptInjectorFromRuntime(
			ReflectiveInjector.resolveAndCreate(normalized.providers),
		);
	}

	static fromParentInjector(
		parent: SecuritydeptInjectorTrait,
		providers: readonly SecuritydeptProvider[],
	): SecuritydeptInjector {
		const normalized = normalizeProviders([
			{
				provide: PARENT_INJECTOR_TOKEN,
				useValue: parent,
			},
			...providers,
			createInjectorSelfProvider(),
		]);
		return getSecuritydeptInjectorFromRuntime(
			ReflectiveInjector.resolveAndCreate(
				normalized.providers,
				toRuntimeInjector(parent),
			),
		);
	}

	static fromRuntimeInjector(
		runtimeInjector: RuntimeInjector,
	): SecuritydeptInjector {
		return new SecuritydeptInjector(runtimeInjector);
	}

	private constructor(private readonly runtimeInjector: RuntimeInjector) {}

	get<T>(token: SecuritydeptDependencyToken<T>): T;
	get<T>(token: SecuritydeptDependencyToken<T>, notFoundValue: T): T;
	get<T>(token: SecuritydeptDependencyToken<T>, notFoundValue?: T): T {
		try {
			// biome-ignore lint/complexity/noArguments: Overloads are more ergonomic for the common non-optional case.
			if (arguments.length === 1) {
				return this.runtimeInjector.get(token as RuntimeProviderToken<T>);
			}
			return this.runtimeInjector.get(
				token as RuntimeProviderToken<T>,
				notFoundValue,
			);
		} catch (error) {
			throw createInjectorResolutionError(token, error);
		}
	}
}

export const INJECTOR_TOKEN =
	new SecuritydeptInjectionToken<SecuritydeptInjector>("INJECTOR_TOKEN");

export const PARENT_INJECTOR_TOKEN =
	new SecuritydeptInjectionToken<SecuritydeptInjectorTrait>(
		"PARENT_INJECTOR_TOKEN",
	);

function normalizeProviders(
	providers: readonly SecuritydeptProvider[],
): NormalizedProviders {
	const runtimeProviders = providers.map((provider) => {
		if (typeof provider === "function") {
			return provider as RuntimeProvider;
		}

		if ("useValue" in provider) {
			return {
				provide: provider.provide,
				useValue: provider.useValue,
			} satisfies RuntimeProvider;
		}

		if ("useClass" in provider) {
			return {
				provide: provider.provide,
				useFactory: (...deps: unknown[]) =>
					new (provider.useClass as new (...args: unknown[]) => unknown)(
						...deps,
					),
				deps: provider.deps ? [...provider.deps] : undefined,
			} satisfies RuntimeProvider;
		}

		if ("useExisting" in provider) {
			return {
				provide: provider.provide,
				useExisting: provider.useExisting,
			} satisfies RuntimeProvider;
		}

		return {
			provide: provider.provide,
			useFactory: provider.useFactory,
			deps: provider.deps ? [...provider.deps] : undefined,
		} satisfies RuntimeProvider;
	});

	return {
		providers: runtimeProviders,
	};
}

function createInjectorSelfProvider(): SecuritydeptFactoryProvider<SecuritydeptInjector> {
	return {
		provide: INJECTOR_TOKEN,
		useFactory: (runtimeInjector: RuntimeInjector) =>
			SecuritydeptInjector.fromRuntimeInjector(runtimeInjector),
		deps: [RuntimeInjector],
	};
}

function getSecuritydeptInjectorFromRuntime(
	runtimeInjector: RuntimeInjector,
): SecuritydeptInjector {
	return runtimeInjector.get(
		INJECTOR_TOKEN as RuntimeProviderToken<SecuritydeptInjector>,
	);
}

class SecuritydeptRuntimeParentAdapter extends RuntimeInjector {
	constructor(private readonly parent: SecuritydeptInjectorTrait) {
		super();
	}

	override get<T>(token: RuntimeProviderToken<T>): T;
	override get<T>(token: RuntimeProviderToken<T>, notFoundValue: T): T;
	override get<T>(token: RuntimeProviderToken<T>, notFoundValue?: T): T {
		// biome-ignore lint/complexity/noArguments: Overloads are more ergonomic for the common non-optional case.
		if (arguments.length === 1) {
			return this.parent.get(token);
		}
		return this.parent.get(token, notFoundValue as T);
	}
}

export function toRuntimeInjector(
	parent: SecuritydeptInjectorTrait,
): RuntimeInjector {
	return new SecuritydeptRuntimeParentAdapter(parent);
}

function createInjectorResolutionError(
	token: SecuritydeptDependencyToken<unknown>,
	error: unknown,
): Error {
	const tokenLabel = describeDependencyToken(token);
	const originalMessage =
		error instanceof Error ? error.message : String(error);
	const message = /No provider/i.test(originalMessage)
		? `[SecuritydeptInjector] No provider found for ${tokenLabel}.`
		: `[SecuritydeptInjector] Failed to resolve ${tokenLabel}: ${originalMessage}`;

	return new Error(message, {
		cause: error instanceof Error ? error : undefined,
	});
}

function describeDependencyToken(
	token: SecuritydeptDependencyToken<unknown>,
): string {
	if (token instanceof RuntimeInjectionToken) {
		return token.toString().replace(/^InjectionToken\s+/, "Token ");
	}

	if (typeof token === "function" && token.name) {
		return token.name;
	}

	return String(token);
}
