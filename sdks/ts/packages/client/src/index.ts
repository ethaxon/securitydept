// @securitydept/client — Foundation public API

// --- Cancellation ---
export type {
	CancelableHandle,
	CancellationTokenSourceTrait,
	CancellationTokenTrait,
} from "./cancellation/index";
export {
	createCancellationTokenSource,
	createLinkedCancellationToken,
	isCancellationTokenTrait,
} from "./cancellation/index";
export {
	type InteropObservableTrait,
	isInteropObservableTrait,
	type ObserverTrait,
	type SubscribableTrait,
	type SubscriptionTrait,
	SYMBOL_OBSERVABLE,
} from "./compat";
// --- Environment ---
export type {
	CreateClientEnvironmentOptions,
	EnvironmentValidators,
	FoundationEnvironment,
	PageLifecycleTrait,
	PopupTrait,
	RouterNavigationRequest,
	RouterTrait,
	SecuritydeptEnvTraitInputValidator,
	ServiceWorkerEnvironment,
	TelemetryTrait,
} from "./environment/index";
export {
	createClientEnvironment,
	validateEnvTraitInput,
} from "./environment/index";
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
	EventObserverTrait,
	EventOperatorFunction,
	EventSource,
	EventStreamTrait,
	EventSubjectTrait,
	EventSubscriptionTrait,
	RuntimeEventEnvelope,
	ToEventStreamInput,
} from "./events";
export {
	createEmptyEventStream,
	createEventReplaySubject,
	createEventStream,
	createEventSubject,
	createNeverEventStream,
	EventSourceKind,
	toEventStream,
} from "./events";
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
} from "./logging";
export {
	createConsoleLogger,
	createNoopLogger,
	createOperationTracer,
	createTraceTimelineStore,
	LogLevel,
	OperationTraceEventType,
} from "./logging";
// --- Persistence ---
export type {
	Codec,
	EphemeralFlowStore,
	KeyedEphemeralFlowStore,
	PersistentAuthStore,
	RecoverableStateStore,
	StorageTrait,
	StoredEnvelope,
} from "./persistence";
export {
	createEphemeralFlowStore,
	createInMemoryRecordStore,
	createJsonCodec,
	createKeyedEphemeralFlowStore,
} from "./persistence";
export {
	eventStreamToObservable,
	observableToEventStream,
	signalToObservable,
} from "./rx";
// --- Scheduling ---
export type {
	IdleCallbackTrait,
	TimestampProviderTrait,
	TimeTrait,
} from "./scheduling/index";
export { createDefaultTimeConfig, parseDurationToMs } from "./scheduling/index";
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
// --- Span ---
export type {
	CreateSpanOptions,
	ForkSpanOptions,
	SpanContextHostTrait,
	SpanTrait,
} from "./span/index";
export {
	createSpan,
	createSpanContextHost,
	createSpanContextHostForNodeLike,
	createSpanContextHostForTest,
	createSpanContextHostForWeb,
} from "./span/index";
export type {
	CreateExternalTransportForFetchOptions,
	CreateTimeForStdOptions,
} from "./std/index";
export {
	createExternalTransportForFetch,
	createTelemetryForStd,
	createTimeForStd,
	FetchTransportRedirectKind,
} from "./std/index";
// --- Struct ---
export type {
	OnDemandTaskQueueOptions,
	OnDemandTaskQueueTaskEnvelope,
} from "./struct/index";
export { OnDemandTaskQueue } from "./struct/index";
// --- Transport ---
export type {
	AuthorizationHeaderProviderTrait,
	BaseTransportTrait,
	BearerHeaderProvider,
	CreateAuthorizedTransportOptions,
	CreateRemappingAuthorizedTransportOptions,
	ExternalTransportTrait,
	HttpRequest,
	HttpResponse,
	ManagedTransportTrait,
	ReplayBearerHeaderProvider,
} from "./transport/index";
export {
	createAuthorizedTransport,
	createRemappingAuthorizedTransport,
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
	CreateEnvironmentForNativeWebOptions,
	NativeWebEnvironment,
} from "./web/environment/environment";
