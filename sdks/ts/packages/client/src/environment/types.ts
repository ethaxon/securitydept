import type {
	LoggerTrait,
	OperationTracerTrait,
	TraceEventSinkTrait,
} from "../logging/types";
import type { StorageTrait } from "../persistence/types";
import type { IdleCallbackTrait, TimeTrait } from "../scheduling/types";
import type { SpanContextHostTrait } from "../span/types";
import type { BaseTransportTrait } from "../transport/types";

export interface TelemetryTrait {
	logger?: LoggerTrait;
	traceSink?: TraceEventSinkTrait;
	operationTracer?: OperationTracerTrait;
}

export interface PageLifecycleTrait<TResumeEvent = unknown> {
	resume: import("../events/types").EventStreamTrait<TResumeEvent>;
}

export interface RouterNavigationRequest {
	url: string | URL;
	intent:
		| "auth_redirect"
		| "post_auth_redirect"
		| "callback_cleanup"
		| "external_open";
	mode: "push" | "replace" | "external";
	state?: unknown;
}

export interface RouterTrait {
	currentUrl(): URL | null;
	canNavigate(request: RouterNavigationRequest): boolean | Promise<boolean>;
	navigate(request: RouterNavigationRequest): void | Promise<void>;
}

export interface PopupOpenOptions {
	target?: string;
	width?: number;
	height?: number;
}

export interface PopupWindowTrait {
	closed: boolean;
	close(): void;
}

export interface PopupWindowHandleTrait {
	window: PopupWindowTrait;
}

export interface PopupTrait {
	open(url: string, options?: PopupOpenOptions): PopupWindowHandleTrait;
	waitForRelay(options: {
		popup: PopupWindowHandleTrait;
		timeoutMs?: number;
		expectedOrigin?: string;
		pollIntervalMs?: number;
	}): Promise<string>;
	relayCallback(options: {
		payload?: string;
		error?: string;
		targetOrigin?: string;
	}): void;
}

/**
 * Foundation dependency environment injected into client-side auth runtimes
 * via explicit wiring at the composition root.
 *
 * All capabilities are optional except `transport`.
 * Missing capabilities use no-op defaults where applicable.
 * `createClientEnvironment()` is a convenience helper for common setups;
 * callers can also wire this interface directly.
 */
export interface FoundationEnvironment {
	transport: BaseTransportTrait;
	time: TimeTrait;
	idleCallback?: IdleCallbackTrait;
	persistentStorage?: StorageTrait;
	sessionStorage?: StorageTrait;
	spanContext?: SpanContextHostTrait;
	telemetry?: TelemetryTrait;
	router?: RouterTrait;
	pageLifecycle?: PageLifecycleTrait;
	popup?: PopupTrait;
}

export interface ServiceWorkerEnvironment extends FoundationEnvironment {}
