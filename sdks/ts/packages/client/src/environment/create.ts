import type { StorageTrait } from "../persistence/types";
import type { IdleCallbackTrait } from "../scheduling/types";
import type { SpanContextHostTrait } from "../span/types";
import { createTelemetryForStd, createTimeForStd } from "../std/index";
import type { BaseTransportTrait } from "../transport/types";
import type {
	FoundationEnvironment,
	PageLifecycleTrait,
	PopupTrait,
	RouterTrait,
	TelemetryTrait,
} from "./types";
import type { EnvironmentValidators } from "./validators";

export interface CreateClientEnvironmentOptions {
	transport: BaseTransportTrait;
	time?: FoundationEnvironment["time"];
	idleCallback?: IdleCallbackTrait;
	persistentStorage?: StorageTrait;
	sessionStorage?: StorageTrait;
	spanContext?: SpanContextHostTrait;
	telemetry?: TelemetryTrait;
	router?: RouterTrait;
	pageLifecycle?: PageLifecycleTrait;
	popup?: PopupTrait;
	validators?: EnvironmentValidators;
}

/**
 * Create a `FoundationEnvironment` with non-host-specific defaults filled in for
 * convenience.
 *
 * Base runtime capabilities should be supplied explicitly or composed via
 * canonical helpers such as `createExternalTransportForFetch()` and
 * `createTimeForStd()`. Host-specific traits still belong to explicit host
 * adapters such as `@securitydept/client/web`.
 */
export function createClientEnvironment(
	overrides: CreateClientEnvironmentOptions,
): FoundationEnvironment {
	const time =
		overrides.time ??
		createTimeForStd({
			validators: overrides.validators,
		});

	return {
		transport: overrides.transport,
		time,
		idleCallback: overrides.idleCallback,
		persistentStorage: overrides.persistentStorage,
		sessionStorage: overrides.sessionStorage,
		spanContext: overrides.spanContext,
		telemetry: createTelemetryForStd({
			...overrides.telemetry,
			spanContext: overrides.spanContext,
			time,
			validators: overrides.validators,
		}),
		router: overrides.router,
		pageLifecycle: overrides.pageLifecycle,
		popup: overrides.popup,
	};
}
