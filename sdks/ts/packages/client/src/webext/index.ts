export {
	type CreateEnvironmentForWebExtBackgroundScriptOptions,
	type CreateEnvironmentForWebExtCoreOptions,
	type CreateEnvironmentForWebExtUIOptions,
	createEnvironmentForWebExtBackgroundScript,
	createEnvironmentForWebExtCore,
	createEnvironmentForWebExtUI,
	type WebExtBackgroundEnvironment,
	type WebExtCoreEnvironment,
	type WebExtUIEnvironment,
} from "./environment";
export {
	createRouterForWebExt,
	type RouterForWebExtCreateOptions,
	type WebExtRouterBrowserLike,
} from "./router";
export {
	createPersistentStorageForWebExt,
	createSessionStorageForWebExt,
	createStorageForWebExt,
	type StorageForWebExtCreateOptions,
	type WebExtStorageAreaLike,
	type WebExtStorageBrowserLike,
} from "./storage";
