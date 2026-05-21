import type { Provider as RuntimeProvider } from "injection-js";
import {
	ReflectiveInjector,
	InjectionToken as RuntimeInjectionToken,
	Injector as RuntimeInjector,
	inject as runtimeInject,
	runInInjectionContext as runtimeRunInInjectionContext,
} from "injection-js";

export class SecuritydeptInjectionToken<T> extends RuntimeInjectionToken<T> {}

export type SecuritydeptAbstractType<T> = abstract new (...args: never[]) => T;

export type SecuritydeptDependencyToken<T> =
	| SecuritydeptInjectionToken<T>
	| SecuritydeptAbstractType<T>;

export type SecuritydeptTypeProvider<T> = SecuritydeptAbstractType<T>;

export interface SecuritydeptValueProvider<T> {
	provide: SecuritydeptDependencyToken<T>;
	useValue: T;
}

export interface SecuritydeptClassProvider<T> {
	provide: SecuritydeptDependencyToken<T>;
	useClass: SecuritydeptAbstractType<T>;
	deps?: readonly SecuritydeptDependencyToken<unknown>[];
}

export interface SecuritydeptFactoryProvider<T> {
	provide: SecuritydeptDependencyToken<T>;
	useFactory: (...deps: never[]) => T;
	deps?: readonly SecuritydeptDependencyToken<unknown>[];
}

export interface SecuritydeptExistingProvider<T> {
	provide: SecuritydeptDependencyToken<T>;
	useExisting: SecuritydeptDependencyToken<T>;
}

export type SecuritydeptProvider<T = unknown> =
	| SecuritydeptTypeProvider<T>
	| SecuritydeptValueProvider<T>
	| SecuritydeptClassProvider<T>
	| SecuritydeptFactoryProvider<T>
	| SecuritydeptExistingProvider<T>;

export interface SecuritydeptInjectorTrait {
	get<T>(token: SecuritydeptDependencyToken<T>): T;
	get<T>(token: SecuritydeptDependencyToken<T>, notFoundValue: T): T;
}

export interface SecuritydeptInjectOptions {
	optional?: boolean;
}

export abstract class SecuritydeptDestroyRef {
	abstract readonly destroyed: boolean;
	abstract onDestroy(callback: () => void): () => void;
}

interface NormalizedProviders {
	providers: RuntimeProvider[];
	knownTokens: Set<SecuritydeptDependencyToken<unknown>>;
}

export class SecuritydeptInjector implements SecuritydeptInjectorTrait {
	static resolveAndCreate(
		providers: readonly SecuritydeptProvider[],
	): SecuritydeptInjector {
		const normalized = normalizeProviders(providers);
		return new SecuritydeptInjector(
			ReflectiveInjector.resolveAndCreate(normalized.providers),
			normalized.knownTokens,
		);
	}

	static fromParentInjector(
		parent: SecuritydeptInjectorTrait,
		providers: readonly SecuritydeptProvider[],
	): SecuritydeptInjector {
		const normalized = normalizeProviders(providers);
		return new SecuritydeptInjector(
			ReflectiveInjector.resolveAndCreate(
				normalized.providers,
				toRuntimeInjector(parent),
			),
			normalized.knownTokens,
			parent,
		);
	}

	private constructor(
		private readonly runtimeInjector: RuntimeInjector,
		private readonly knownTokens: ReadonlySet<
			SecuritydeptDependencyToken<unknown>
		>,
		private readonly parent?: SecuritydeptInjectorTrait,
	) {}

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

	has(token: SecuritydeptDependencyToken<unknown>): boolean {
		if (this.knownTokens.has(token)) {
			return true;
		}

		if (this.parent instanceof SecuritydeptInjector) {
			return this.parent.has(token);
		}

		const maybeParentWithHas = this.parent as {
			has?: (dependencyToken: SecuritydeptDependencyToken<unknown>) => boolean;
		};
		if (typeof maybeParentWithHas?.has === "function") {
			return maybeParentWithHas.has(token);
		}

		return false;
	}
}

type RuntimeProviderToken<T> =
	| RuntimeInjectionToken<T>
	| SecuritydeptAbstractType<T>;

export function inject<T>(
	token: SecuritydeptDependencyToken<T>,
	options?: SecuritydeptInjectOptions & { optional?: false },
): T;
export function inject<T>(
	token: SecuritydeptDependencyToken<T>,
	options?: SecuritydeptInjectOptions & { optional?: true },
): T | null;
export function inject<T>(
	token: SecuritydeptDependencyToken<T>,
	options?: SecuritydeptInjectOptions,
): T | null {
	if (options?.optional === true) {
		return runtimeInject(token as RuntimeProviderToken<T>, {
			optional: true,
		});
	}

	return runtimeInject(token as RuntimeProviderToken<T>);
}

export function tryInjectInInjectionContext<T>(
	token: SecuritydeptDependencyToken<T>,
	options?: SecuritydeptInjectOptions,
): T | null {
	try {
		if (options?.optional === true) {
			return inject(token, { optional: true });
		}

		return inject(token);
	} catch (error) {
		if (isMissingInjectionContextError(error)) {
			return null;
		}

		throw error;
	}
}

export function runInInjectionContext<ReturnT>(
	injector: SecuritydeptInjectorTrait,
	fn: () => ReturnT,
): ReturnT {
	return runtimeRunInInjectionContext(toRuntimeInjector(injector), fn);
}

function isMissingInjectionContextError(error: unknown): boolean {
	return (
		error instanceof Error &&
		error.message.includes("can only be used within an injection context")
	);
}

function normalizeProviders(
	providers: readonly SecuritydeptProvider[],
): NormalizedProviders {
	const knownTokens = new Set<SecuritydeptDependencyToken<unknown>>();
	const runtimeProviders = providers.map((provider) => {
		if (typeof provider === "function") {
			knownTokens.add(provider);
			return provider as RuntimeProvider;
		}

		knownTokens.add(provider.provide);
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
		knownTokens,
	};
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

class ManagedSecuritydeptDestroyRef extends SecuritydeptDestroyRef {
	private isDestroyed = false;
	private readonly listeners = new Set<() => void>();

	get destroyed(): boolean {
		return this.isDestroyed;
	}

	onDestroy(callback: () => void): () => void {
		if (this.isDestroyed) {
			callback();
			return () => undefined;
		}

		this.listeners.add(callback);
		return () => {
			this.listeners.delete(callback);
		};
	}

	destroy(): void {
		if (this.isDestroyed) {
			return;
		}

		this.isDestroyed = true;
		const listeners = [...this.listeners];
		this.listeners.clear();
		for (const listener of listeners) {
			listener();
		}
	}
}

export function createSecuritydeptDestroyRef(): SecuritydeptDestroyRef {
	return new ManagedSecuritydeptDestroyRef();
}

function toRuntimeInjector(parent: SecuritydeptInjectorTrait): RuntimeInjector {
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
