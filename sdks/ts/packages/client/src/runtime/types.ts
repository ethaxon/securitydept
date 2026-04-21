import type {
	LoggerTrait,
	OperationTracerTrait,
	TraceEventSinkTrait,
} from "../logging/types";
import type { RecordStore } from "../persistence/types";
import type { Clock, Scheduler } from "../scheduling/types";
import type { HttpTransport } from "../transport/types";

/**
 * Runtime capability bundle — injected into auth context clients
 * via explicit wiring at composition root.
 *
 * All capabilities are optional except `transport`.
 * Missing capabilities use no-op defaults where applicable.
 * `createRuntime()` is a convenience helper for common setups;
 * callers can also wire this interface directly.
 */
export interface ClientRuntime {
	transport: HttpTransport;
	scheduler: Scheduler;
	clock: Clock;
	logger?: LoggerTrait;
	traceSink?: TraceEventSinkTrait;
	operationTracer?: OperationTracerTrait;
	/** Optional persistent storage backing. */
	persistentStore?: RecordStore;
	/** Optional session-scoped storage backing. */
	sessionStore?: RecordStore;
}
