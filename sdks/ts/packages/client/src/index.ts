// @securitydept/client — Foundation public API
// --- Auth Coordination ---
export {
	type AuthGuardClientOption,
	type AuthRequirement,
	type CandidateSelector,
	type ChooserDecision,
	type CreatePlannerHostOptions,
	type CreateRequirementPlannerOptions,
	type CreateRouteRequirementOrchestratorOptions,
	createPlannerHost,
	createRequirementPlanner,
	createRouteRequirementOrchestrator,
	type PlannerHost,
	type PlannerHostResult,
	type PlanSnapshot,
	PlanStatus,
	type RequirementPlanner,
	RequirementPlannerError,
	type RequirementResolution,
	type RequirementsClientSet,
	RequirementsClientSetComposition,
	ResolutionStatus,
	type RouteMatchNode,
	type RouteOrchestrationSnapshot,
	type RouteRequirementOrchestrator,
	resolveEffectiveClientSet,
	type ScopedRequirementsClientSet,
} from "./auth-coordination";
// --- Cancellation ---
export {
	type CancelableHandle,
	type CancellationTokenSourceTrait,
	type CancellationTokenTrait,
	createCancellationTokenSource,
	createLinkedCancellationToken,
	isCancellationTokenTrait,
} from "./cancellation";
// --- Compat ---
export {
	type AsyncDisposableTrait,
	type DisposableTrait,
	type InteropObservableTrait,
	isInteropObservableTrait,
	type ObserverTrait,
	type SubscribableTrait,
	type SubscriptionTrait,
	SYMBOL_ASYNC_DISPOSE,
	SYMBOL_DISPOSE,
	SYMBOL_OBSERVABLE,
} from "./compat";
// --- Environment ---
export {
	type CreateFoundationEnvironmentOptions,
	createFoundationEnvironment,
	type EnvironmentValidators,
	FOUNDATION_ENVIRONMENT_TOKEN,
	type FoundationEnvironment,
	type ServiceWorkerEnvironment,
} from "./environment";
// --- Errors ---
export {
	ClientError,
	type ClientErrorAttributes,
	ClientErrorKind,
	type ClientErrorRecovery,
	ClientErrorSource,
	describeError,
	type ErrorAttributes,
	type ErrorPresentation,
	type ErrorPresentationActionDescriptor,
	type ErrorPresentationDescriptor,
	ErrorPresentationTone,
	type NativeErrorAttributes,
	type ReadErrorPresentationDescriptorOptions,
	readErrorPresentationDescriptor,
	type UnknownErrorAttributes,
	UserRecovery,
} from "./errors";
// --- Events ---
export {
	abortSignalToEventStream,
	createEmptyEventStream,
	createEventReplaySubject,
	createEventStream,
	createEventSubject,
	createNeverEventStream,
	type EventObserverTrait,
	type EventOperatorFunction,
	type EventSource,
	EventSourceKind,
	type EventStreamTrait,
	type EventSubjectTrait,
	type EventSubscriptionTrait,
	type RuntimeEventEnvelope,
	type ToEventStreamInput,
	toEventStream,
} from "./events";
// --- Identity ---
export {
	type AuthenticatedPrincipal,
	normalizeAuthenticatedPrincipal,
	normalizeAuthenticatedPrincipalWire,
	type ProjectAuthenticatedPrincipalOptions,
	projectAuthenticatedPrincipal,
} from "./identity";
// --- Injection ---
export {
	createProviderIfTokenMissing,
	createSecuritydeptDestroyRef,
	getSecuritydeptProviderToken,
	INJECTOR_TOKEN,
	inject,
	notMissingProvider,
	runInInjectionContext,
	SecurityDeptOptional,
	type SecuritydeptAbstractType,
	type SecuritydeptClassProvider,
	type SecuritydeptDependencyDescriptor,
	type SecuritydeptDependencyToken,
	SecuritydeptDestroyRef,
	type SecuritydeptExistingProvider,
	type SecuritydeptFactoryProvider,
	SecuritydeptInjectionToken,
	type SecuritydeptInjectOptions,
	SecuritydeptInjector,
	type SecuritydeptInjectorTrait,
	type SecuritydeptProvider,
	type SecuritydeptTypeProvider,
	type SecuritydeptValueProvider,
	tryInjectInInjectionContext,
	type WithTraitDeps,
} from "./injection";
// --- Page ---
export {
	PAGE_LIFECYCLE_TRAIT_TOKEN,
	type PageLifecycleTrait,
} from "./page";
// --- Popup ---
export {
	type CreatePopupClientSessionOptions,
	type CreatePopupServerSessionOptions,
	POPUP_TRAIT_TOKEN,
	type PopupAttachFailure,
	PopupAttachFailureReason,
	type PopupAttachResult,
	type PopupAttachSuccess,
	PopupClientWindowHandle,
	PopupClientWindowHandleTrait,
	PopupErrorCode,
	PopupMessageChannelTrait,
	PopupOpenOptions,
	PopupServerWindowHandle,
	PopupServerWindowHandleTrait,
	PopupTrait,
	PopupWindowHandleTrait,
} from "./popup";
// --- Protocol ---
export {
	type CreateJsonRpcClientOptions,
	type CreateJsonRpcServerAndClientOptions,
	type CreateJsonRpcServerOptions,
	createJsonRpcClient,
	createJsonRpcServer,
	createJsonRpcServerAndClient,
	type JsonRpcClientTrait,
	type JsonRpcErrorPayload,
	type JsonRpcErrorResponseMessage,
	type JsonRpcId,
	type JsonRpcMessage,
	type JsonRpcNotificationEvent,
	type JsonRpcNotificationMessage,
	type JsonRpcRequestEvent,
	type JsonRpcRequestMessage,
	type JsonRpcRequestOptions,
	type JsonRpcServerAndClientTrait,
	type JsonRpcServerTrait,
	type JsonRpcSuccessResponseMessage,
} from "./protocol/json-rpc";
// --- Router ---
export type {
	GuardedRouterTrait,
	RouterBeforeLoad,
	RouterGuardContext,
	RouterGuardDecision,
	RouterNavigationRequest,
	RouterTrait,
} from "./router";
export {
	ROUTER_TRAIT_TOKEN,
	RouterGuardDecisionKind,
	RouterGuardPhase,
} from "./router";
// --- Scheduling ---
export {
	createDefaultTimeConfig,
	IDLE_CALLBACK_TRAIT_TOKEN,
	type IdleCallbackTrait,
	parseDurationToMs,
	TIME_TRAIT_TOKEN,
	type TimestampProviderTrait,
	type TimeTrait,
} from "./scheduling";
// --- Signals ---
export {
	type ComputedReplaySignalTrait,
	type ComputedSignalTrait,
	createAndThenComputedReplaySignal,
	createComputed,
	createComputedReplaySignal,
	createReplaySignal,
	createSignal,
	isReplaySignalTrait,
	type ReadableReplaySignalTrait,
	type ReadableSignalTrait,
	type ReplaySignalSlot,
	type ReplaySignalWhenValueOptions,
	readonlyReplaySignal,
	readonlySignal,
	type WritableReplaySignalTrait,
	type WritableSignalTrait,
} from "./signals";
// --- Span ---
export {
	createRootSpan,
	type OperationSpanTrait,
	SPAN_TRAIT_TOKEN,
	type SpanCreateOptions,
	type SpanTrait,
} from "./span";
// --- Std ---
export type {
	BaseTransportForStdFetchCreateOptions,
	TimeForStdCreateOptions,
} from "./std";
export {
	abortSignalToCancellationToken,
	cancellationTokenToAbortSignal,
	createBaseTransportForStdFetch,
	createTimeForStd,
	FetchTransportRedirectKind,
	normalizeAbortError,
} from "./std";
// --- Storage ---
export {
	type Codec,
	createEphemeralFlowStore,
	createInMemoryRecordStore,
	createJsonCodec,
	createKeyedEphemeralFlowStore,
	type EphemeralFlowStore,
	type KeyedEphemeralFlowStore,
	PERSISTENT_STORAGE_TRAIT_TOKEN,
	type PersistentAuthStore,
	type RecoverableStateStore,
	SESSION_STORAGE_TRAIT_TOKEN,
	type StorageTrait,
	type StoredEnvelope,
} from "./storage";
// --- Structs ---
export {
	createOnceAsyncLockCallable,
	type OnceAsyncLock,
	type OnceAsyncLockCallable,
	type OnceAsyncLockError,
	type OnceAsyncLockInit,
	type OnceAsyncLockRunning,
	OnceAsyncLockState,
	type OnceAsyncLockSuccess,
} from "./struct";
// --- Tracing ---
export {
	createConsoleTracingSubscriber,
	createTraceTimelineStore,
	createTracing,
	type DefineInstrumentMethodDecoratorContext,
	type DefineInstrumentMethodDecoratorFactory,
	defineInstrumentMethodDecorator,
	type InstrumentMethodResolvedOptions,
	type InstrumentMethodThisContext,
	type InstrumentMethodThisResolver,
	OperationTraceEventType,
	type RunOperationEnvironment,
	type RunOperationOptions,
	type RunOperationOptionsBase,
	runOperation,
	TRACING_TRAIT_TOKEN,
	type TraceTimelineEntry,
	type TraceTimelineStore,
	type TracingCreateOptions,
	type TracingEvent,
	TracingLevel,
	type TracingSubscriberTrait,
	type TracingTrait,
} from "./tracing";
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
} from "./transport";
export {
	createAuthorizedTransportFromBase,
	createExternalTransportFromBase,
	createRemappingAuthorizedTransportFromBase,
	TRANSPORT_TRAIT_TOKEN,
} from "./transport";
// --- Validation ---
export {
	formatValidationFailure,
	type TraitInputValidator,
	throwValidationClientError,
	type ValidateTraitInputOptions,
	type ValidationFailure,
	type ValidationResult,
	type ValidationSuccess,
	validateTraitInput,
	validateWithSchema,
	validateWithSchemaSync,
	type WithTraitInputValidator,
} from "./validation";
