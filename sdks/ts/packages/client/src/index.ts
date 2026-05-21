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
// --- Environment ---
export type {
	ClientEnvironment,
	CreateClientEnvironmentOptions,
} from "./environment/index";
export { createClientEnvironment } from "./environment/index";
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
	ReplaySubjectTrait,
	RuntimeEventEnvelope,
	SubjectTrait,
} from "./events/index";
export {
	concatMap,
	createEventStream,
	createReplaySubject,
	createSubject,
	debounceTime,
	EventSourceKind,
	exhaustMap,
	filter,
	finalize,
	fromRxObservable,
	map,
	merge,
	pipe,
	share,
	shareReplay,
	switchMap,
	takeUntil,
	tap,
	throttleTime,
	toRxObservable,
	withLatestFromSignal,
} from "./events/index";
// --- Identity ---
export type {
	AuthenticatedPrincipal,
	ProjectAuthenticatedPrincipalOptions,
} from "./identity/index";
export {
	normalizeAuthenticatedPrincipal,
	normalizeAuthenticatedPrincipalWire,
	projectAuthenticatedPrincipal,
} from "./identity/index";
// --- Logging ---
export type {
	CreateOperationTracerOptions,
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
	createOperationTracer,
	createTraceTimelineStore,
	LogLevel,
	OperationTraceEventType,
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
// --- Scheduling ---
export type {
	CancelableHandle as SchedulerCancelableHandle,
	Clock,
	FromEventPatternOptions,
	FromPromiseOptions,
	FromSignalOptions,
	IntervalOptions,
	PromiseSettlement,
	ScheduleAtOptions,
	Scheduler,
	Subscription,
	TimerOptions,
} from "./scheduling/index";
export {
	createDefaultClock,
	createDefaultIdleScheduler,
	createDefaultScheduler,
	fromEventPattern,
	fromPromise,
	fromSignal,
	interval,
	PromiseSettlementKind,
	parseDurationToMs,
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
export type {
	CreateWebClientEnvironmentOptions,
	PageClientEnvironment,
	PageHistoryLike,
	PageLocationCapability,
	PageLocationHistoryCapability,
	PageLocationLike,
	WebClientEnvironment,
} from "./web/environment/client-environment";
export { ClientEnvironmentPreset } from "./web/environment/client-environment";
