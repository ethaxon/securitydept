import {
	SecuritydeptInjectionToken,
	type SecuritydeptInjector,
} from "../injection";
import { type PageLifecycleTrait } from "../page";
import { type PopupTrait } from "../popup";
import { type RouterTrait } from "../router";
import { type IdleCallbackTrait, type TimeTrait } from "../scheduling/types";
import { type SpanTrait } from "../span/types";
import { type StorageTrait, type SyncStorageTrait } from "../storage/types";
import { type TracingTrait } from "../tracing/types";
import { type BaseTransportTrait } from "../transport/types";
import { type TraitInputValidator } from "../validation";

/**
 * Foundation dependency environment injected into client-side auth runtimes
 * via explicit wiring at the composition root.
 *
 * `transport`, `time`, `realmStorage`, `span`, and `tracing` are the required baseline
 * capabilities. Optional page/router/popup/storage traits stay explicit.
 * Raw host-material inputs such as `window`, `location`, or browser storage
 * handles are intentionally outside this contract and should be resolved by
 * host-specific creators before a `FoundationEnvironment` is assembled.
 */
export interface FoundationEnvironment {
	injector: SecuritydeptInjector;
	transport: BaseTransportTrait;
	time: TimeTrait;
	realmStorage: SyncStorageTrait;
	idleCallback?: IdleCallbackTrait;
	persistentStorage?: StorageTrait;
	sessionStorage?: StorageTrait;
	span: SpanTrait;
	tracing: TracingTrait;
	router?: RouterTrait;
	pageLifecycle?: PageLifecycleTrait;
	popup?: PopupTrait;
}

export interface ServiceWorkerEnvironment extends FoundationEnvironment {}

export const ENVIRONMENT_TOKEN =
	new SecuritydeptInjectionToken<FoundationEnvironment>("ENVIRONMENT_TOKEN");

export interface EnvironmentValidators {
	transport?: TraitInputValidator;
	transportForStdFetchCreateOptions?: TraitInputValidator;
	time?: TraitInputValidator;
	timeForStdCreateOptions?: TraitInputValidator;
	realmStorage?: TraitInputValidator;
	idleCallback?: TraitInputValidator;
	persistentStorage?: TraitInputValidator;
	sessionStorage?: TraitInputValidator;
	span?: TraitInputValidator;
	spanCreateOptions?: TraitInputValidator;
	tracing?: TraitInputValidator;
	tracingCreateOptions?: TraitInputValidator;
	router?: TraitInputValidator;
	pageLifecycle?: TraitInputValidator;
	popup?: TraitInputValidator;
}
