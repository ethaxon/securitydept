import {
	InjectionToken as RuntimeInjectionToken,
	Optional as RuntimeOptional,
} from "injection-js";

export class SecuritydeptInjectionToken<T> extends RuntimeInjectionToken<T> {}

export type SecuritydeptAbstractType<T> = abstract new (...args: never[]) => T;

export type SecuritydeptDependencyToken<T> =
	| SecuritydeptInjectionToken<T>
	| SecuritydeptAbstractType<T>;

export type SecuritydeptTypeProvider<T> = SecuritydeptAbstractType<T>;

export const SecurityDeptOptional = RuntimeOptional;

export type SecuritydeptOptionalDependency<T> =
	| readonly [
			InstanceType<typeof SecurityDeptOptional>,
			SecuritydeptDependencyToken<T>,
	  ]
	| readonly [
			SecuritydeptDependencyToken<T>,
			InstanceType<typeof SecurityDeptOptional>,
	  ];

export type SecuritydeptDependencyDescriptor<T> =
	| SecuritydeptDependencyToken<T>
	| SecuritydeptOptionalDependency<T>;

export interface SecuritydeptValueProvider<T> {
	provide: SecuritydeptDependencyToken<T>;
	useValue: T;
}

export interface SecuritydeptClassProvider<T> {
	provide: SecuritydeptDependencyToken<T>;
	useClass: SecuritydeptAbstractType<T>;
	deps?: readonly SecuritydeptDependencyDescriptor<unknown>[];
}

export interface SecuritydeptFactoryProvider<T> {
	provide: SecuritydeptDependencyToken<T>;
	useFactory: (...deps: never[]) => T;
	deps?: readonly SecuritydeptDependencyDescriptor<unknown>[];
}

export type WithTraitDeps<TDeps extends object> = TDeps;

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

export function getSecuritydeptProviderToken(
	provider: SecuritydeptProvider,
): SecuritydeptDependencyToken<unknown> {
	if (typeof provider === "function") {
		return provider;
	}
	return provider.provide;
}

export function createProviderIfTokenMissing<
	TProvider extends SecuritydeptProvider,
>(
	providedTokens: ReadonlySet<SecuritydeptDependencyToken<unknown>>,
	token: SecuritydeptDependencyToken<unknown>,
	createProvider: () => TProvider,
): TProvider | null {
	return providedTokens.has(token) ? null : createProvider();
}

export function notMissingProvider(
	provider: SecuritydeptProvider | null,
): provider is SecuritydeptProvider {
	return provider !== null;
}

export interface SecuritydeptInjectorTrait {
	get<T>(token: SecuritydeptDependencyToken<T>): T;
	get<T>(token: SecuritydeptDependencyToken<T>, notFoundValue: T): T;
}
