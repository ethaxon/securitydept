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
import { POPUP_TRAIT_TOKEN } from "../popup";
import { ROUTER_TRAIT_TOKEN, type RouterTrait } from "../router";
import { TIME_TRAIT_TOKEN, type TimeTrait } from "../scheduling/types";
import {
	PERSISTENT_STORAGE_TRAIT_TOKEN,
	SESSION_STORAGE_TRAIT_TOKEN,
} from "../storage/types";
import {
	createPageLifecycleForNativeWeb,
	type PageLifecycleForNativeWebCreateOptions,
} from "./page";
import {
	createPopupForNativeWeb,
	type PopupForNativeWebCreateOptions,
} from "./popup";
import {
	createRouterForNativeWeb,
	type RouterForNativeWebCreateOptions,
} from "./router";
import {
	createPersistentStorageForNativeWeb,
	createSessionStorageForNativeWeb,
	type StorageForNativeWebCreateOptions,
} from "./storage";

export { type FoundationEnvironment } from "../environment/types";

export interface NativeWebEnvironment extends FoundationEnvironment {
	router: RouterTrait;
}

export interface CreateEnvironmentForNativeWebOptions
	extends CreateFoundationEnvironmentOptions {
	routerForNativeWebCreateOptions?: RouterForNativeWebCreateOptions;
	pageLifecycleForNativeWebCreateOptions?: PageLifecycleForNativeWebCreateOptions;
	popupForNativeWebCreateOptions?: PopupForNativeWebCreateOptions;
	persistentStorageForNativeWebCreateOptions?: Omit<
		StorageForNativeWebCreateOptions,
		"validatorKey"
	>;
	sessionStorageForNativeWebCreateOptions?: Omit<
		StorageForNativeWebCreateOptions,
		"validatorKey"
	>;
}

export function createEnvironmentForNativeWeb(
	options: CreateEnvironmentForNativeWebOptions,
): NativeWebEnvironment {
	const userProviders = options.providers ?? [];
	const externalProviderTokens = new Set(
		userProviders.map((provider) => getSecuritydeptProviderToken(provider)),
	);
	const providers = [
		...createNativeWebTraitProviders(options, externalProviderTokens),
		...userProviders,
	];
	return createFoundationEnvironment({
		providers,
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
	}) as NativeWebEnvironment;
}

function createNativeWebTraitProviders(
	options: CreateEnvironmentForNativeWebOptions,
	externalProviderTokens: ReadonlySet<
		SecuritydeptValueProvider<unknown>["provide"]
	>,
): SecuritydeptProvider[] {
	return [
		createProviderIfTokenMissing(
			externalProviderTokens,
			ROUTER_TRAIT_TOKEN,
			() =>
				createNativeWebTraitUnit({
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
				createNativeWebTraitUnit({
					provide: PAGE_LIFECYCLE_TRAIT_TOKEN,
					value: options.pageLifecycle,
					createValue: () =>
						createPageLifecycleForNativeWeb({
							...options.pageLifecycleForNativeWebCreateOptions,
							validators: options.validators,
						}),
				}),
		),
		createProviderIfTokenMissing(
			externalProviderTokens,
			POPUP_TRAIT_TOKEN,
			() =>
				createNativeWebTraitUnit({
					provide: POPUP_TRAIT_TOKEN,
					value: options.popup,
					createValue: (time: TimeTrait) =>
						createPopupForNativeWeb({
							time,
							...options.popupForNativeWebCreateOptions,
							validators: options.validators,
						}),
					deps: [TIME_TRAIT_TOKEN],
				}),
		),
		createProviderIfTokenMissing(
			externalProviderTokens,
			PERSISTENT_STORAGE_TRAIT_TOKEN,
			() =>
				createNativeWebTraitUnit({
					provide: PERSISTENT_STORAGE_TRAIT_TOKEN,
					value: options.persistentStorage,
					createValue: () =>
						createPersistentStorageForNativeWeb({
							...options.persistentStorageForNativeWebCreateOptions,
							validators: options.validators,
						}),
				}),
		),
		createProviderIfTokenMissing(
			externalProviderTokens,
			SESSION_STORAGE_TRAIT_TOKEN,
			() =>
				createNativeWebTraitUnit({
					provide: SESSION_STORAGE_TRAIT_TOKEN,
					value: options.sessionStorage,
					createValue: () =>
						createSessionStorageForNativeWeb({
							...options.sessionStorageForNativeWebCreateOptions,
							validators: options.validators,
						}),
				}),
		),
	].filter(notMissingProvider);
}

function createNativeWebTraitUnit<T>(options: {
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
