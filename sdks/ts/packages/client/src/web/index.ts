// --- Web environment presets ---
export {
	type CreateEnvironmentForNativeWebOptions,
	createEnvironmentForNativeWeb,
	type FoundationEnvironment,
	type NativeWebEnvironment,
} from "./environment";
// --- Browser event sources ---
export {
	type CreatePageResumeSourceOptions,
	createPageResumeSource,
	type FromStorageEventOptions,
	fromStorageEvent,
	type PageResumeDocumentTarget,
	type PageResumeEvent,
	PageResumeTriggerKind,
	type PageResumeWindowTarget,
	type StorageEventTarget,
} from "./events";
export {
	createPageLifecycleForNativeWeb,
	type PageLifecycleForNativeWebCreateOptions,
} from "./page";
export {
	computePopupFeatures,
	createPopupForNativeWeb,
	type PopupFeaturesOptions,
	type PopupForNativeWebCreateOptions,
} from "./popup";
export {
	createRouterForNativeWeb,
	type NativeWebHistoryLike,
	type NativeWebLocationLike,
	type NativeWebNavigationLike,
	NativeWebRouter,
	type NativeWebWindowLike,
	type RouterForNativeWebCreateOptions,
	WebLegacyRouter,
	WebNavigationRouter,
} from "./router";
export {
	createPersistentStorageForNativeWeb,
	createSessionStorageForNativeWeb,
	createStorageForNativeWeb,
	type NativeWebStorageLike,
	type StorageForNativeWebCreateOptions,
} from "./storage";
// --- Cross-tab state sync ---
export {
	type CreateCrossTabSyncOptions,
	type CrossTabSyncEvent,
	createCrossTabSync,
} from "./sync/cross-tab-sync";
