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
	ClientErrorAttributes,
	ClientErrorRecovery,
	ErrorAttributes,
	ErrorPresentation,
	ErrorPresentationActionDescriptor,
	ErrorPresentationDescriptor,
	NativeErrorAttributes,
	ReadErrorPresentationDescriptorOptions,
	UnknownErrorAttributes,
} from "./errors/index";
export {
	ClientError,
	ClientErrorKind,
	ClientErrorSource,
	describeError,
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
	map,
	merge,
	pipe,
	share,
	shareReplay,
	switchMap,
	takeUntil,
	tap,
	throttleTime,
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
export { fromRxObservable, toRxObservable } from "./rx/index";
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
	ComputedReplaySignalTrait,
	ComputedSignalTrait,
	ReadableReplaySignalTrait,
	ReadableSignalTrait,
	ReplaySignalSlot,
	ReplaySignalWhenValueOptions,
	WritableReplaySignalTrait,
	WritableSignalTrait,
} from "./signals/index";
export {
	createAndThenComputedReplaySignal,
	createComputed,
	createComputedReplaySignal,
	createReplaySignal,
	createSignal,
	isReplaySignalTrait,
	readonlyReplaySignal,
	readonlySignal,
} from "./signals/index";
// --- Struct ---
export type {
	OnDemandTaskQueueOptions,
	OnDemandTaskQueueTaskEnvelope,
} from "./struct/index";
export { OnDemandTaskQueue } from "./struct/index";
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
