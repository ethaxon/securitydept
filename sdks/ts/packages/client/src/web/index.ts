// --- Web client environment presets ---
export type {
	CreateEnvironmentForNativeWebOptions,
	FoundationEnvironment,
	NativeWebEnvironment,
} from "./environment";
export { createEnvironmentForNativeWeb } from "./environment";
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
export type { PageLifecycleForNativeWebCreateOptions } from "./page";
export { createPageLifecycleForNativeWeb } from "./page";
export type {
	PopupFeaturesOptions,
	PopupForNativeWebCreateOptions,
} from "./popup";
export {
	computePopupFeatures,
	createPopupForNativeWeb,
} from "./popup";
export type {
	GuardedRouterForNativeWebCreateOptions,
	NativeWebHistoryLike,
	NativeWebLocationLike,
	NativeWebNavigationLike,
	NativeWebWindowLike,
	RouterForNativeWebCreateOptions,
} from "./router";
export {
	createGuardedRouterForNativeWeb,
	createRouterForNativeWeb,
	GuardedNativeWebRouter,
	GuardedWebLegacyRouter,
	GuardedWebNavigationRouter,
	NativeWebRouter,
	WebLegacyRouter,
	WebNavigationRouter,
} from "./router";
export type {
	NativeWebStorageLike,
	StorageForNativeWebCreateOptions,
} from "./storage";
export {
	createPersistentStorageForNativeWeb,
	createSessionStorageForNativeWeb,
	createStorageForNativeWeb,
} from "./storage";
// --- Cross-tab state sync ---
export type {
	CreateCrossTabSyncOptions,
	CrossTabSyncEvent,
} from "./sync/cross-tab-sync";
export { createCrossTabSync } from "./sync/cross-tab-sync";
export { isLoopbackHttpUrl } from "./utils/network";
export { transformScriptForBrowser } from "./utils/scripts";
