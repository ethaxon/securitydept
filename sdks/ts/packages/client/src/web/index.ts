export type { FetchTransportOptions } from "../transport/fetch-transport";
export {
	createFetchTransport,
	FetchTransportRedirectKind,
} from "../transport/fetch-transport";
export type { AbortSignalBridge } from "./cancellation";
export {
	createAbortSignalBridge,
	normalizeAbortError,
} from "./cancellation";
// --- Cross-tab state sync ---
export type {
	CreateCrossTabSyncOptions,
	CrossTabSync,
	CrossTabSyncCallback,
} from "./cross-tab-sync";
export { createCrossTabSync } from "./cross-tab-sync";
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
export type { CreateWebRuntimeOptions } from "./runtime";
export { createWebRuntime } from "./runtime";
// --- Browser input adapters ---
export type { FromVisibilityChangeOptions } from "./visibility";
export { fromVisibilityChange, VisibilityState } from "./visibility";
// --- Visibility lifecycle hardening ---
export type {
	CreateVisibilityReconcilerOptions,
	ReconcileCallback,
	VisibilityReconciler,
} from "./visibility-reconciler";
export { createVisibilityReconciler } from "./visibility-reconciler";
