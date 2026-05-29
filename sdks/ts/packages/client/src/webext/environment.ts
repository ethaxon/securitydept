import {
	type CreateFoundationEnvironmentOptions,
	createFoundationEnvironment,
} from "../environment/create";
import { type FoundationEnvironment } from "../environment/types";
import {
	createProviderIfTokenMissing,
	getSecuritydeptProviderToken,
	notMissingProvider,
	type SecuritydeptDependencyDescriptor,
	type SecuritydeptFactoryProvider,
	type SecuritydeptProvider,
	type SecuritydeptValueProvider,
} from "../injection";
import { PAGE_LIFECYCLE_TRAIT_TOKEN } from "../page";
import { ROUTER_TRAIT_TOKEN } from "../router";
import {
	PERSISTENT_STORAGE_TRAIT_TOKEN,
	SESSION_STORAGE_TRAIT_TOKEN,
} from "../storage/types";
import {
	createPageLifecycleForNativeWeb,
	type PageLifecycleForNativeWebCreateOptions,
} from "../web/page";
import {
	createRouterForNativeWeb,
	type RouterForNativeWebCreateOptions,
} from "../web/router";
import {
	createRouterForWebExt,
	type RouterForWebExtCreateOptions,
} from "./router";
import {
	createPersistentStorageForWebExt,
	createSessionStorageForWebExt,
	type StorageForWebExtCreateOptions,
} from "./storage";

export interface CreateEnvironmentForWebExtCoreOptions
	extends CreateFoundationEnvironmentOptions {
	routerForWebExtCreateOptions?: RouterForWebExtCreateOptions;
	persistentStorageForWebExtCreateOptions?: Omit<
		StorageForWebExtCreateOptions,
		"validatorKey"
	>;
	sessionStorageForWebExtCreateOptions?: Omit<
		StorageForWebExtCreateOptions,
		"validatorKey"
	>;
}

export interface CreateEnvironmentForWebExtBackgroundScriptOptions
	extends CreateEnvironmentForWebExtCoreOptions {}

export interface CreateEnvironmentForWebExtUIOptions
	extends CreateEnvironmentForWebExtCoreOptions {
	routerForNativeWebCreateOptions?: RouterForNativeWebCreateOptions;
	pageLifecycleForNativeWebCreateOptions?: PageLifecycleForNativeWebCreateOptions;
}

export interface WebExtCoreEnvironment extends FoundationEnvironment {}

export interface WebExtBackgroundEnvironment extends WebExtCoreEnvironment {}

export interface WebExtUIEnvironment extends WebExtCoreEnvironment {}

export function createEnvironmentForWebExtCore(
	options: CreateEnvironmentForWebExtCoreOptions,
): WebExtCoreEnvironment {
	const userProviders = options.providers ?? [];
	const externalProviderTokens = new Set(
		userProviders.map((provider) => getSecuritydeptProviderToken(provider)),
	);

	return createFoundationEnvironment({
		providers: [
			...createWebExtTraitProviders(options, externalProviderTokens),
			...userProviders,
		],
		transport: options.transport,
		transportForStdFetchCreateOptions:
			options.transportForStdFetchCreateOptions,
		time: options.time,
		timeForStdCreateOptions: options.timeForStdCreateOptions,
		idleCallback: options.idleCallback,
		span: options.span,
		spanCreateOptions: options.spanCreateOptions,
		tracing: options.tracing,
		tracingCreateOptions: options.tracingCreateOptions,
		validators: options.validators,
	}) as WebExtCoreEnvironment;
}

export function createEnvironmentForWebExtBackgroundScript(
	options: CreateEnvironmentForWebExtBackgroundScriptOptions,
): WebExtBackgroundEnvironment {
	return createEnvironmentForWebExtCore(options) as WebExtBackgroundEnvironment;
}

export function createEnvironmentForWebExtUI(
	options: CreateEnvironmentForWebExtUIOptions,
): WebExtUIEnvironment {
	const userProviders = options.providers ?? [];
	const userProviderTokens = new Set(
		userProviders.map((provider) => getSecuritydeptProviderToken(provider)),
	);
	const uiProviders = createWebExtUITraitProviders(options, userProviderTokens);
	const externalProviderTokens = new Set([
		...userProviderTokens,
		...uiProviders.map((provider) => getSecuritydeptProviderToken(provider)),
	]);

	return createFoundationEnvironment({
		...options,
		providers: [
			...createWebExtTraitProviders(options, externalProviderTokens),
			...uiProviders,
			...userProviders,
		],
	}) as WebExtUIEnvironment;
}

function createWebExtTraitProviders(
	options: CreateEnvironmentForWebExtCoreOptions,
	externalProviderTokens: ReadonlySet<
		SecuritydeptValueProvider<unknown>["provide"]
	>,
): SecuritydeptProvider[] {
	return [
		createProviderIfTokenMissing(
			externalProviderTokens,
			ROUTER_TRAIT_TOKEN,
			() =>
				createWebExtTraitUnit({
					provide: ROUTER_TRAIT_TOKEN,
					value: options.router,
					createValue: () =>
						createRouterForWebExt({
							...options.routerForWebExtCreateOptions,
							validators: options.validators,
						}),
				}),
		),
		createProviderIfTokenMissing(
			externalProviderTokens,
			PERSISTENT_STORAGE_TRAIT_TOKEN,
			() =>
				createWebExtTraitUnit({
					provide: PERSISTENT_STORAGE_TRAIT_TOKEN,
					value: options.persistentStorage,
					createValue: () =>
						createPersistentStorageForWebExt({
							...options.persistentStorageForWebExtCreateOptions,
							validators: options.validators,
						}),
				}),
		),
		createProviderIfTokenMissing(
			externalProviderTokens,
			SESSION_STORAGE_TRAIT_TOKEN,
			() =>
				createWebExtTraitUnit({
					provide: SESSION_STORAGE_TRAIT_TOKEN,
					value: options.sessionStorage,
					createValue: () =>
						createSessionStorageForWebExt({
							...options.sessionStorageForWebExtCreateOptions,
							validators: options.validators,
						}),
				}),
		),
	].filter(notMissingProvider);
}

function createWebExtUITraitProviders(
	options: CreateEnvironmentForWebExtUIOptions,
	externalProviderTokens: ReadonlySet<
		SecuritydeptValueProvider<unknown>["provide"]
	>,
): SecuritydeptProvider[] {
	return [
		createProviderIfTokenMissing(
			externalProviderTokens,
			ROUTER_TRAIT_TOKEN,
			() =>
				createWebExtTraitUnit({
					provide: ROUTER_TRAIT_TOKEN,
					value: options.router,
					createValue: () =>
						createRouterForNativeWeb({
							...options.routerForNativeWebCreateOptions,
							validators: options.validators,
						}),
				}),
		),
		createProviderIfTokenMissing(
			externalProviderTokens,
			PAGE_LIFECYCLE_TRAIT_TOKEN,
			() =>
				createWebExtTraitUnit({
					provide: PAGE_LIFECYCLE_TRAIT_TOKEN,
					value: options.pageLifecycle,
					createValue: () =>
						createPageLifecycleForNativeWeb({
							...options.pageLifecycleForNativeWebCreateOptions,
							validators: options.validators,
						}),
				}),
		),
	].filter(notMissingProvider);
}

function createWebExtTraitUnit<T>(options: {
	provide: SecuritydeptValueProvider<T | null>["provide"];
	value: T | null | undefined;
	deps?: readonly SecuritydeptDependencyDescriptor<unknown>[];
	createValue(...deps: readonly unknown[]): T | null;
}): SecuritydeptProvider {
	if (options.value !== undefined) {
		return {
			provide: options.provide,
			useValue: options.value,
		} satisfies SecuritydeptValueProvider<T | null>;
	}

	return {
		provide: options.provide,
		useFactory: options.createValue as (...deps: never[]) => T | null,
		deps: options.deps,
	} satisfies SecuritydeptFactoryProvider<T | null>;
}
