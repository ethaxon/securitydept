export type { AbortSignalBridge } from "./cancellation/abort-signal";
export {
	createAbortSignalBridge,
	createCancellationTokenFromAbortSignal,
	normalizeAbortError,
} from "./cancellation/abort-signal";
// --- Web client environment presets ---
export type {
	ClientEnvironment,
	CreateBrowserPageClientEnvironmentOptions,
	CreateWebClientEnvironmentOptions,
	PageClientEnvironment,
	PageHistoryLike,
	PageLocationCapability,
	PageLocationHistoryCapability,
	PageLocationLike,
	RequirePageClientEnvironmentOptions,
	WebClientEnvironment,
} from "./environment/client-environment";
export {
	assertPageLocationCapability,
	assertPageLocationHistoryCapability,
	assertResolveEnvironment,
	assertResolveFromEnvironment,
	ClientEnvironmentPreset,
	createBrowserExtensionBackgroundClientEnvironment,
	createBrowserPageClientEnvironment,
	createBrowserWorkerClientEnvironment,
	createServiceWorkerClientEnvironment,
	createWebClientEnvironment,
	deriveClientEnvironment,
	readDefaultPageLocationCapability,
	readDefaultPageLocationHistoryCapability,
	readPageLocationCapability,
	readPageLocationHistoryCapability,
	requireDefaultPageLocationCapability,
	requireDefaultPageLocationHistoryCapability,
	requirePageClientEnvironment,
} from "./environment/client-environment";
export type { ClientEnvironmentServiceOptions } from "./environment/environment-service";
export { ClientEnvironmentService } from "./environment/environment-service";
// --- Browser input adapters ---
export type {
	FromAbortSignalOptions,
	FromStorageEventOptions,
} from "./events/input-sources";
export { fromAbortSignal, fromStorageEvent } from "./events/input-sources";
export type { FromVisibilityChangeOptions } from "./events/visibility";
export { fromVisibilityChange, VisibilityState } from "./events/visibility";
// --- Visibility lifecycle hardening ---
export type {
	CreatePageResumeReconcilerOptions,
	PageResumeCallback,
	PageResumeDocumentTarget,
	PageResumeEvent,
	PageResumeReconciler,
	PageResumeWindowTarget,
} from "./lifecycle/page-resume-reconciler";
export {
	createPageResumeReconciler,
	PageResumeTriggerKind,
} from "./lifecycle/page-resume-reconciler";
export type {
	CreateVisibilityReconcilerOptions,
	ReconcileCallback,
	VisibilityReconciler,
} from "./lifecycle/visibility-reconciler";
export { createVisibilityReconciler } from "./lifecycle/visibility-reconciler";
// --- Popup shared infrastructure ---
export type {
	PopupFeaturesOptions,
	PopupRelayMessage,
	PopupWindowHandle,
	RelayPopupCallbackOptions,
	WaitForPopupRelayOptions,
} from "./popup/popup";
export {
	computePopupFeatures,
	openPopupWindow,
	PopupErrorCode,
	relayPopupCallback,
	waitForPopupRelay,
} from "./popup/popup";
// --- Cross-tab state sync ---
export type {
	CreateCrossTabSyncOptions,
	CrossTabSync,
	CrossTabSyncCallback,
} from "./sync/cross-tab-sync";
export { createCrossTabSync } from "./sync/cross-tab-sync";
export type { FetchTransportOptions } from "./transport/fetch-transport";
export {
	createFetchTransport,
	FetchTransportRedirectKind,
} from "./transport/fetch-transport";
export { isLoopbackHttpUrl, transformScriptForBrowser } from "./utils/helpers";
