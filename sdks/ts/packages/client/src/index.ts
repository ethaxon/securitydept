// @securitydept/client — Foundation public API

// --- Cancellation ---
export type {
	CancelableHandle,
	CancellationTokenSourceTrait,
	CancellationTokenTrait,
	DisposableTrait,
} from "./cancellation/index";
export {
	createCancellationTokenSource,
	createLinkedCancellationToken,
} from "./cancellation/index";
// --- Errors ---
export type {
	ErrorPresentation,
	ErrorPresentationActionDescriptor,
	ErrorPresentationDescriptor,
	ReadErrorPresentationDescriptorOptions,
} from "./errors/index";
export {
	ClientError,
	ClientErrorKind,
	ClientErrorSource,
	ErrorPresentationTone,
	readErrorPresentationDescriptor,
	UserRecovery,
} from "./errors/index";
// --- Events ---
export type {
	EventObserver,
	EventOperator,
	EventSource,
	EventStreamTrait,
	EventSubscriptionTrait,
	RuntimeEventEnvelope,
} from "./events/index";
export {
	createEventStream,
	EventSourceKind,
	filter,
	finalize,
	map,
	merge,
	pipe,
	takeUntil,
	tap,
} from "./events/index";
// --- Logging ---
export type {
	LogEntry,
	LoggerTrait,
	OperationScope,
	OperationTracerTrait,
	TraceEvent,
	TraceEventSinkTrait,
	TraceTimelineEntry,
	TraceTimelineStore,
} from "./logging/index";
export {
	createConsoleLogger,
	createNoopLogger,
	createTraceTimelineStore,
	LogLevel,
} from "./logging/index";
// --- Persistence ---
export type {
	Codec,
	EphemeralFlowStore,
	KeyedEphemeralFlowStore,
	PersistentAuthStore,
	RecordStore,
	RecoverableStateStore,
	StoredEnvelope,
} from "./persistence/index";
export {
	createEphemeralFlowStore,
	createInMemoryRecordStore,
	createJsonCodec,
	createKeyedEphemeralFlowStore,
} from "./persistence/index";
// --- Runtime ---
export type { ClientRuntime, CreateRuntimeOptions } from "./runtime/index";
export { createRuntime } from "./runtime/index";
// --- Scheduling ---
export type {
	CancelableHandle as SchedulerCancelableHandle,
	Clock,
	FromEventPatternOptions,
	IntervalOptions,
	ScheduleAtOptions,
	Scheduler,
	Subscription,
	TimerOptions,
} from "./scheduling/index";
export {
	createDefaultClock,
	createDefaultScheduler,
	fromEventPattern,
	interval,
	scheduleAt,
	timer,
} from "./scheduling/index";
// --- Signals ---
export type {
	ComputedSignalTrait,
	ReadableSignalTrait,
	WritableSignalTrait,
} from "./signals/index";
export {
	createComputed,
	createSignal,
	readonlySignal,
} from "./signals/index";
// --- Transport ---
export type {
	HttpRequest,
	HttpResponse,
	HttpTransport,
} from "./transport/index";
export { FetchTransportRedirectKind } from "./transport/index";
// --- Validation ---
export type {
	ValidationFailure,
	ValidationResult,
	ValidationSuccess,
} from "./validation/index";
export {
	createSchema,
	validateWithSchema,
	validateWithSchemaSync,
} from "./validation/index";
