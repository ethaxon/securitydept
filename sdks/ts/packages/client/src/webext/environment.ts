import {
	type CreateFoundationEnvironmentOptions,
	createFoundationEnvironment,
} from "../environment/create";
import { type FoundationEnvironment } from "../environment/types";
import {
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
	pageLifecycleForNativeWebCreateOptions?: PageLifecycleForNativeWebCreateOptions;
}

export interface WebExtCoreEnvironment extends FoundationEnvironment {}

export interface WebExtBackgroundEnvironment extends WebExtCoreEnvironment {}

export interface WebExtUIEnvironment extends WebExtCoreEnvironment {}

export function createEnvironmentForWebExtCore(
	options: CreateEnvironmentForWebExtCoreOptions,
): WebExtCoreEnvironment {
	return createFoundationEnvironment({
		providers: [
			...createWebExtTraitProviders(options),
			...(options.providers ?? []),
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
	return createEnvironmentForWebExtCore({
		...options,
		providers: [
			...createWebExtUITraitProviders(options),
			...(options.providers ?? []),
		],
	}) as WebExtUIEnvironment;
}

function createWebExtTraitProviders(
	options: CreateEnvironmentForWebExtCoreOptions,
): SecuritydeptProvider[] {
	return [
		createWebExtTraitUnit({
			provide: ROUTER_TRAIT_TOKEN,
			value: options.router,
			createValue: () =>
				createRouterForWebExt({
					...options.routerForWebExtCreateOptions,
					validators: options.validators,
				}),
		}),
		createWebExtTraitUnit({
			provide: PERSISTENT_STORAGE_TRAIT_TOKEN,
			value: options.persistentStorage,
			createValue: () =>
				createPersistentStorageForWebExt({
					...options.persistentStorageForWebExtCreateOptions,
					validators: options.validators,
				}),
		}),
		createWebExtTraitUnit({
			provide: SESSION_STORAGE_TRAIT_TOKEN,
			value: options.sessionStorage,
			createValue: () =>
				createSessionStorageForWebExt({
					...options.sessionStorageForWebExtCreateOptions,
					validators: options.validators,
				}),
		}),
	];
}

function createWebExtUITraitProviders(
	options: CreateEnvironmentForWebExtUIOptions,
): SecuritydeptProvider[] {
	return [
		createWebExtTraitUnit({
			provide: PAGE_LIFECYCLE_TRAIT_TOKEN,
			value: options.pageLifecycle,
			createValue: () =>
				createPageLifecycleForNativeWeb({
					...options.pageLifecycleForNativeWebCreateOptions,
					validators: options.validators,
				}),
		}),
	];
}

function createWebExtTraitUnit<T>(options: {
	provide: SecuritydeptValueProvider<T | null>["provide"];
	value: T | null | undefined;
	createValue(): T | null;
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
	} satisfies SecuritydeptFactoryProvider<T | null>;
}
