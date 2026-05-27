export type {
	CreateEnvironmentForWebExtBackgroundScriptOptions,
	CreateEnvironmentForWebExtCoreOptions,
	CreateEnvironmentForWebExtUIOptions,
	WebExtBackgroundEnvironment,
	WebExtCoreEnvironment,
	WebExtUIEnvironment,
} from "./environment";
export {
	createEnvironmentForWebExtBackgroundScript,
	createEnvironmentForWebExtCore,
	createEnvironmentForWebExtUI,
} from "./environment";
export type {
	RouterForWebExtCreateOptions,
	WebExtRouterBrowserLike,
} from "./router";
export { createRouterForWebExt } from "./router";
export type {
	StorageForWebExtCreateOptions,
	WebExtStorageAreaLike,
	WebExtStorageBrowserLike,
} from "./storage";
export {
	createPersistentStorageForWebExt,
	createSessionStorageForWebExt,
	createStorageForWebExt,
} from "./storage";
