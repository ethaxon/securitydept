export type { AbortSignalBridge } from "./cancellation/abort-signal";
export {
	createAbortSignalBridge,
	createCancellationTokenFromAbortSignal,
	normalizeAbortError,
} from "./cancellation/abort-signal";
// --- Web client environment presets ---
export type {
	CreateEnvironmentForNativeWebOptions,
	FoundationEnvironment,
	NativeWebEnvironment,
} from "./environment/environment";
export {
	assertResolveEnvironment,
	createEnvironmentForNativeWeb,
} from "./environment/environment";
export type { CreatePageLifecycleForNativeWebOptions } from "./environment/page-lifecycle";
export { createPageLifecycleForNativeWeb } from "./environment/page-lifecycle";
export type { CreatePopupForNativeWebOptions } from "./environment/popup";
export { createPopupForNativeWeb } from "./environment/popup";
export type {
	CreateRouterForNativeWebOptions,
	CreateRouterForTestOptions,
	NativeWebHistoryLike,
	NativeWebLocationLike,
	NativeWebNavigationLike,
	NativeWebWindowLike,
} from "./environment/router";
export {
	createRouterForNativeWeb,
	createRouterForTest,
} from "./environment/router";
export type {
	CreateStorageForNativeWebOptions,
	NativeWebStorageLike,
} from "./environment/storage";
export {
	createPersistentStorageForNativeWeb,
	createSessionStorageForNativeWeb,
	createStorageForNativeWeb,
} from "./environment/storage";
// --- Browser event sources ---
export type {
	CreatePageResumeSourceOptions,
	FromStorageEventOptions,
	PageResumeDocumentTarget,
	PageResumeEvent,
	PageResumeWindowTarget,
	StorageEventTarget,
} from "./events";

export {
	createPageResumeSource,
	fromStorageEvent,
	PageResumeTriggerKind,
} from "./events";

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
export { isLoopbackHttpUrl } from "./utils/network";
export { transformScriptForBrowser } from "./utils/scripts";
