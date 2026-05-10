export type { FetchTransportOptions } from "../transport/fetch-transport";
export {
	createFetchTransport,
	FetchTransportRedirectKind,
} from "../transport/fetch-transport";
export type { AbortSignalBridge } from "./cancellation";
export {
	createAbortSignalBridge,
	createCancellationTokenFromAbortSignal,
	normalizeAbortError,
} from "./cancellation";
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
} from "./client-environment";
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
} from "./client-environment";
// --- Cross-tab state sync ---
export type {
	CreateCrossTabSyncOptions,
	CrossTabSync,
	CrossTabSyncCallback,
} from "./cross-tab-sync";
export { createCrossTabSync } from "./cross-tab-sync";
export type { ClientEnvironmentServiceOptions } from "./environment-service";
export { ClientEnvironmentService } from "./environment-service";
// --- Browser input adapters ---
export type {
	FromAbortSignalOptions,
	FromStorageEventOptions,
} from "./input-sources";
export { fromAbortSignal, fromStorageEvent } from "./input-sources";
// --- Visibility lifecycle hardening ---
export type {
	CreatePageResumeReconcilerOptions,
	PageResumeCallback,
	PageResumeDocumentTarget,
	PageResumeEvent,
	PageResumeReconciler,
	PageResumeWindowTarget,
} from "./page-resume-reconciler";
export {
	createPageResumeReconciler,
	PageResumeTriggerKind,
} from "./page-resume-reconciler";
// --- Popup shared infrastructure ---
export type {
	PopupFeaturesOptions,
	PopupRelayMessage,
	PopupWindowHandle,
	RelayPopupCallbackOptions,
	WaitForPopupRelayOptions,
} from "./popup";
export {
	computePopupFeatures,
	openPopupWindow,
	PopupErrorCode,
	relayPopupCallback,
	waitForPopupRelay,
} from "./popup";
export type { FromVisibilityChangeOptions } from "./visibility";
export { fromVisibilityChange, VisibilityState } from "./visibility";
export type {
	CreateVisibilityReconcilerOptions,
	ReconcileCallback,
	VisibilityReconciler,
} from "./visibility-reconciler";
export { createVisibilityReconciler } from "./visibility-reconciler";
