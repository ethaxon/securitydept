import {
	createProviderIfTokenMissing,
	getSecuritydeptProviderToken,
	INJECTOR_TOKEN,
	notMissingProvider,
	type SecuritydeptDependencyDescriptor,
	type SecuritydeptFactoryProvider,
	SecuritydeptInjector,
	type SecuritydeptProvider,
	type SecuritydeptValueProvider,
} from "../injection";
import {
	PAGE_LIFECYCLE_TRAIT_TOKEN,
	type PageLifecycleTrait,
	PageLifecycleTraitSchema,
} from "../page";
import { POPUP_TRAIT_TOKEN, type PopupTrait, PopupTraitSchema } from "../popup";
import {
	ROUTER_TRAIT_TOKEN,
	type RouterTrait,
	RouterTraitSchema,
} from "../router";
import {
	IDLE_CALLBACK_TRAIT_TOKEN,
	type IdleCallbackTrait,
	IdleCallbackTraitSchema,
	TIME_TRAIT_TOKEN,
	type TimeTrait,
	TimeTraitSchema,
} from "../scheduling/types";
import { createRootSpan } from "../span";
import {
	SPAN_TRAIT_TOKEN,
	type SpanCreateOptions,
	type SpanTrait,
	SpanTraitSchema,
} from "../span/types";
import { createBaseTransportForStdFetch, createTimeForStd } from "../std/index";
import { type TimeForStdCreateOptions } from "../std/time";
import { type BaseTransportForStdFetchCreateOptions } from "../std/transport";
import { createInMemoryRecordStore } from "../storage/memory-store";
import {
	PERSISTENT_STORAGE_TRAIT_TOKEN,
	REALM_STORAGE_TRAIT_TOKEN,
	SESSION_STORAGE_TRAIT_TOKEN,
	type StorageTrait,
	StorageTraitSchema,
} from "../storage/types";
import { createTracing } from "../tracing";
import { type TracingCreateOptions } from "../tracing/create";
import {
	TRACING_TRAIT_TOKEN,
	type TracingTrait,
	TracingTraitSchema,
} from "../tracing/types";
import {
	type BaseTransportTrait,
	BaseTransportTraitSchema,
	TRANSPORT_TRAIT_TOKEN,
} from "../transport/types";
import {
	type TraitInputBundledSchema,
	throwValidationClientError,
	validateTraitInput,
} from "../validation";
import {
	ENVIRONMENT_TOKEN,
	type EnvironmentValidators,
	type FoundationEnvironment,
} from "./types";

export interface CreateFoundationEnvironmentOptions {
	providers?: readonly SecuritydeptProvider[];
	transport?: BaseTransportTrait;
	transportForStdFetchCreateOptions?: BaseTransportForStdFetchCreateOptions;
	time?: TimeTrait;
	timeForStdCreateOptions?: TimeForStdCreateOptions;
	realmStorage?: StorageTrait;
	span?: SpanTrait;
	spanCreateOptions?: SpanCreateOptions;
	tracing?: TracingTrait;
	tracingCreateOptions?: TracingCreateOptions;
	idleCallback?: IdleCallbackTrait | null;
	persistentStorage?: StorageTrait | null;
	sessionStorage?: StorageTrait | null;
	router?: RouterTrait | null;
	pageLifecycle?: PageLifecycleTrait | null;
	popup?: PopupTrait | null;
	validators?: EnvironmentValidators;
}

/**
 * Create a `FoundationEnvironment` from explicit trait units and defaults.
 *
 * This helper owns foundation-wide baseline resolution and trait-graph wiring.
 *
 * It may resolve:
 *   - public std adapters such as
 *     `transportForStdFetchCreateOptions -> transport` and `timeForStdCreateOptions -> time`
 *   - public hostless baseline constructors such as
 *     `spanCreateOptions -> span` and `tracingCreateOptions -> tracing`
 *
 * Host-material discovery such as resolving `window`, `location`, `history`,
 * or browser storage handles belongs to explicit host adapters such as
 * `@securitydept/client/web`, which must first resolve those inputs into
 * concrete traits before calling this helper.
 */
export function createFoundationEnvironment(
	overrides: CreateFoundationEnvironmentOptions,
): FoundationEnvironment {
	const providers = overrides.providers ?? [];
	const externalProviderTokens = new Set(
		providers.map((provider) => getSecuritydeptProviderToken(provider)),
	);
	if (externalProviderTokens.has(ENVIRONMENT_TOKEN)) {
		throwValidationClientError({
			code: "environment.foundation_provider_reserved",
			source: "environment",
			messagePrefix:
				"createFoundationEnvironment does not allow overriding ENVIRONMENT_TOKEN",
		});
	}
	const injector = SecuritydeptInjector.resolveAndCreate([
		...createBuiltInTraitUnits(overrides, externalProviderTokens),
		...providers,
		createFoundationEnvironmentUnit(),
	]);
	return injector.get(ENVIRONMENT_TOKEN);
}

function createBuiltInTraitUnits(
	overrides: CreateFoundationEnvironmentOptions,
	externalProviderTokens: ReadonlySet<
		SecuritydeptValueProvider<unknown>["provide"]
	>,
): SecuritydeptProvider[] {
	const builtInTraitUnits: Array<SecuritydeptProvider | null> = [
		createProviderIfTokenMissing(
			externalProviderTokens,
			TRANSPORT_TRAIT_TOKEN,
			() =>
				createBuiltInTraitUnit({
					token: TRANSPORT_TRAIT_TOKEN,
					traitName: "transport",
					bundledSchema: BaseTransportTraitSchema,
					validator: overrides.validators?.transport,
					createValue: () =>
						overrides.transport ??
						createBaseTransportForStdFetch({
							...overrides.transportForStdFetchCreateOptions,
							validators:
								overrides.validators?.transportForStdFetchCreateOptions,
						}),
				}),
		),
		createProviderIfTokenMissing(externalProviderTokens, TIME_TRAIT_TOKEN, () =>
			createBuiltInTraitUnit({
				token: TIME_TRAIT_TOKEN,
				traitName: "time",
				bundledSchema: TimeTraitSchema,
				validator: overrides.validators?.time,
				createValue: () =>
					overrides.time ??
					createTimeForStd({
						...overrides.timeForStdCreateOptions,
						validators: overrides.validators?.timeForStdCreateOptions,
					}),
			}),
		),
		createProviderIfTokenMissing(
			externalProviderTokens,
			REALM_STORAGE_TRAIT_TOKEN,
			() =>
				createBuiltInTraitUnit({
					token: REALM_STORAGE_TRAIT_TOKEN,
					traitName: "realmStorage",
					bundledSchema: StorageTraitSchema,
					validator: overrides.validators?.realmStorage,
					createValue: () =>
						overrides.realmStorage ?? createInMemoryRecordStore(),
				}),
		),
		createProviderIfTokenMissing(externalProviderTokens, SPAN_TRAIT_TOKEN, () =>
			createBuiltInTraitUnit({
				token: SPAN_TRAIT_TOKEN,
				traitName: "span",
				bundledSchema: SpanTraitSchema,
				validator: overrides.validators?.span,
				createValue: () =>
					overrides.span ??
					createRootSpan({
						...overrides.spanCreateOptions,
						validators: overrides.validators?.spanCreateOptions,
					}),
			}),
		),
		createProviderIfTokenMissing(
			externalProviderTokens,
			TRACING_TRAIT_TOKEN,
			() =>
				createBuiltInTraitUnit({
					token: TRACING_TRAIT_TOKEN,
					traitName: "tracing",
					bundledSchema: TracingTraitSchema,
					validator: overrides.validators?.tracing,
					createValue: () =>
						overrides.tracing ??
						createTracing({
							...overrides.tracingCreateOptions,
							validators: overrides.validators?.tracingCreateOptions,
						}),
				}),
		),
		createProviderIfTokenMissing(
			externalProviderTokens,
			IDLE_CALLBACK_TRAIT_TOKEN,
			() =>
				createBuiltInTraitUnit({
					token: IDLE_CALLBACK_TRAIT_TOKEN,
					traitName: "idleCallback",
					bundledSchema: IdleCallbackTraitSchema,
					validator: overrides.validators?.idleCallback,
					optional: true,
					createValue: () => overrides.idleCallback ?? null,
				}),
		),
		createProviderIfTokenMissing(
			externalProviderTokens,
			PERSISTENT_STORAGE_TRAIT_TOKEN,
			() =>
				createBuiltInTraitUnit({
					token: PERSISTENT_STORAGE_TRAIT_TOKEN,
					traitName: "persistentStorage",
					bundledSchema: StorageTraitSchema,
					validator: overrides.validators?.persistentStorage,
					optional: true,
					createValue: () => overrides.persistentStorage ?? null,
				}),
		),
		createProviderIfTokenMissing(
			externalProviderTokens,
			SESSION_STORAGE_TRAIT_TOKEN,
			() =>
				createBuiltInTraitUnit({
					token: SESSION_STORAGE_TRAIT_TOKEN,
					traitName: "sessionStorage",
					bundledSchema: StorageTraitSchema,
					validator: overrides.validators?.sessionStorage,
					optional: true,
					createValue: () => overrides.sessionStorage ?? null,
				}),
		),
		createProviderIfTokenMissing(
			externalProviderTokens,
			ROUTER_TRAIT_TOKEN,
			() =>
				createBuiltInTraitUnit({
					token: ROUTER_TRAIT_TOKEN,
					traitName: "router",
					bundledSchema: RouterTraitSchema,
					validator: overrides.validators?.router,
					optional: true,
					createValue: () => overrides.router ?? null,
				}),
		),
		createProviderIfTokenMissing(
			externalProviderTokens,
			PAGE_LIFECYCLE_TRAIT_TOKEN,
			() =>
				createBuiltInTraitUnit({
					token: PAGE_LIFECYCLE_TRAIT_TOKEN,
					traitName: "pageLifecycle",
					bundledSchema: PageLifecycleTraitSchema,
					validator: overrides.validators?.pageLifecycle,
					optional: true,
					createValue: () => overrides.pageLifecycle ?? null,
				}),
		),
		createProviderIfTokenMissing(
			externalProviderTokens,
			POPUP_TRAIT_TOKEN,
			() =>
				createBuiltInTraitUnit({
					token: POPUP_TRAIT_TOKEN,
					traitName: "popup",
					bundledSchema: PopupTraitSchema,
					validator: overrides.validators?.popup,
					optional: true,
					createValue: () => overrides.popup ?? null,
				}),
		),
	];

	return builtInTraitUnits.filter(notMissingProvider);
}

function createBuiltInTraitUnit<T>(options: {
	token: SecuritydeptValueProvider<T>["provide"];
	traitName: string;
	bundledSchema: TraitInputBundledSchema;
	validator: EnvironmentValidators[keyof EnvironmentValidators];
	deps?: readonly SecuritydeptDependencyDescriptor<unknown>[];
	optional?: boolean;
	createValue(...deps: readonly unknown[]): T;
}): SecuritydeptFactoryProvider<T> {
	return {
		provide: options.token,
		useFactory: ((...deps: readonly unknown[]) => {
			const value = options.createValue(...deps);
			validateTraitInput({
				value: value,
				bundledSchema: options.bundledSchema,
				validator: options.validator,
				optional: options.optional,
				onInvalid: (failure) =>
					throwValidationClientError({
						code: "environment.trait_validation_failed",
						source: "environment",
						messagePrefix: `${"createFoundationEnvironment"} could not validate ${options.traitName}`,
						failure: failure,
					}),
			});
			return value;
		}) as (...deps: never[]) => T,
		deps: options.deps,
	};
}

function createFoundationEnvironmentUnit(): SecuritydeptFactoryProvider<FoundationEnvironment> {
	return {
		provide: ENVIRONMENT_TOKEN,
		useFactory: ((
			injector: SecuritydeptInjector,
			transport: BaseTransportTrait,
			time: TimeTrait,
			realmStorage: StorageTrait,
			span: SpanTrait,
			tracing: TracingTrait,
			idleCallback: IdleCallbackTrait | null,
			persistentStorage: StorageTrait | null,
			sessionStorage: StorageTrait | null,
			router: RouterTrait | null,
			pageLifecycle: PageLifecycleTrait | null,
			popup: PopupTrait | null,
		) => {
			return {
				injector,
				transport,
				time,
				realmStorage,
				idleCallback: idleCallback ?? undefined,
				persistentStorage: persistentStorage ?? undefined,
				sessionStorage: sessionStorage ?? undefined,
				span,
				tracing,
				router: router ?? undefined,
				pageLifecycle: pageLifecycle ?? undefined,
				popup: popup ?? undefined,
			} satisfies FoundationEnvironment;
		}) as (...deps: never[]) => FoundationEnvironment,
		deps: [
			INJECTOR_TOKEN,
			TRANSPORT_TRAIT_TOKEN,
			TIME_TRAIT_TOKEN,
			REALM_STORAGE_TRAIT_TOKEN,
			SPAN_TRAIT_TOKEN,
			TRACING_TRAIT_TOKEN,
			IDLE_CALLBACK_TRAIT_TOKEN,
			PERSISTENT_STORAGE_TRAIT_TOKEN,
			SESSION_STORAGE_TRAIT_TOKEN,
			ROUTER_TRAIT_TOKEN,
			PAGE_LIFECYCLE_TRAIT_TOKEN,
			POPUP_TRAIT_TOKEN,
		],
	};
}
