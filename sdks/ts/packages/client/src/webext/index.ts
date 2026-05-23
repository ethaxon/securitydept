import { createClientEnvironment } from "../environment/create";
import type {
	FoundationEnvironment,
	RouterNavigationRequest,
	RouterTrait,
	TelemetryTrait,
} from "../environment/types";
import type { EnvironmentValidators } from "../environment/validators";
import { validateEnvTraitInput } from "../environment/validators";
import type { StorageTrait } from "../persistence/types";
import type { TimeTrait } from "../scheduling/types";
import type { BaseTransportTrait } from "../transport/types";
import type { NativeWebEnvironment } from "../web/environment/environment";

export interface WebExtBrowserLike {
	tabs?: {
		create?(options: { url: string }): unknown;
		update?(tabId: number, options: { url: string }): unknown;
		query?(options: { active?: boolean; currentWindow?: boolean }): unknown;
	};
	windows?: {
		create?(options: { url: string }): unknown;
		getCurrent?(): unknown;
	};
	storage?: {
		local?: WebExtStorageAreaLike;
		session?: WebExtStorageAreaLike;
	};
}

export interface WebExtStorageAreaLike {
	get(key: string): Promise<Record<string, unknown>> | Record<string, unknown>;
	set(entries: Record<string, unknown>): Promise<void> | void;
	remove(key: string): Promise<void> | void;
}

export interface CreateRouterForWebExtBackgroundScriptOptions {
	browser?: WebExtBrowserLike | null;
	validators?: Pick<EnvironmentValidators, "router">;
}

export function createRouterForWebExtBackgroundScript(
	options: CreateRouterForWebExtBackgroundScriptOptions = {},
): RouterTrait {
	const global = globalThis as { browser?: WebExtBrowserLike };
	const browser = options.browser ?? global.browser;
	validateEnvTraitInput({
		traitName: "router",
		hostAdapter: "createRouterForWebExtBackgroundScript",
		value: browser,
		validator: options.validators?.router,
		bundleValidate: (value) => {
			const input = value as WebExtBrowserLike | null | undefined;
			return Boolean(input?.tabs?.create || input?.windows?.create);
		},
	});
	const router: RouterTrait = {
		currentUrl() {
			return null;
		},
		canNavigate(request) {
			return (
				Boolean(browser?.tabs?.create || browser?.windows?.create) &&
				request.mode === "external"
			);
		},
		async navigate(request: RouterNavigationRequest) {
			const url = request.url.toString();
			if (browser?.tabs?.create) {
				await browser.tabs.create({ url });
				return;
			}
			if (browser?.windows?.create) {
				await browser.windows.create({ url });
				return;
			}
			throw new Error("Web extension background router cannot open URL.");
		},
	};
	return router;
}

export interface CreateStorageForWebExtOptions {
	storageArea?: WebExtStorageAreaLike | null;
	validators?: Pick<
		EnvironmentValidators,
		"persistentStorage" | "sessionStorage"
	>;
	validatorKey?: "persistentStorage" | "sessionStorage";
}

export function createStorageForWebExt(
	options: CreateStorageForWebExtOptions = {},
): StorageTrait {
	if (!options.storageArea) {
		throw new Error(
			"createStorageForWebExt requires an explicit storage area.",
		);
	}
	const validatorKey = options.validatorKey ?? "persistentStorage";
	validateEnvTraitInput({
		traitName: validatorKey,
		hostAdapter: "createStorageForWebExt",
		value: options.storageArea,
		validator: options.validators?.[validatorKey],
		bundleValidate: (value) =>
			typeof (value as WebExtStorageAreaLike).get === "function" &&
			typeof (value as WebExtStorageAreaLike).set === "function" &&
			typeof (value as WebExtStorageAreaLike).remove === "function",
	});
	const storage: StorageTrait = {
		async get(key) {
			const result = await options.storageArea?.get(key);
			const value = result?.[key];
			return typeof value === "string" ? value : null;
		},
		async set(key, value) {
			await options.storageArea?.set({ [key]: value });
		},
		async remove(key) {
			await options.storageArea?.remove(key);
		},
	};
	return storage;
}

export interface CreateEnvironmentForWebExtBackgroundScriptOptions {
	browser?: WebExtBrowserLike | null;
	transport: BaseTransportTrait;
	time?: TimeTrait;
	router?: RouterTrait;
	persistentStorage?: StorageTrait;
	sessionStorage?: StorageTrait;
	telemetry?: TelemetryTrait;
	validators?: EnvironmentValidators;
}

export interface WebExtCoreEnvironment extends FoundationEnvironment {}

export interface WebExtBackgroundEnvironment extends WebExtCoreEnvironment {}

export type WebExtPageEnvironment = WebExtCoreEnvironment &
	NativeWebEnvironment;

export function createEnvironmentForWebExtBackgroundScript(
	options: CreateEnvironmentForWebExtBackgroundScriptOptions,
): WebExtBackgroundEnvironment {
	const global = globalThis as { browser?: WebExtBrowserLike };
	const browser = options.browser ?? global.browser;
	return createClientEnvironment({
		transport: options.transport,
		time: options.time,
		router:
			options.router ??
			createRouterForWebExtBackgroundScript({
				browser,
				validators: options.validators,
			}),
		persistentStorage:
			options.persistentStorage ??
			(browser?.storage?.local
				? createStorageForWebExt({
						storageArea: browser.storage.local,
						validators: options.validators,
						validatorKey: "persistentStorage",
					})
				: undefined),
		sessionStorage:
			options.sessionStorage ??
			(browser?.storage?.session
				? createStorageForWebExt({
						storageArea: browser.storage.session,
						validators: options.validators,
						validatorKey: "sessionStorage",
					})
				: undefined),
		telemetry: options.telemetry,
		validators: options.validators,
	}) as WebExtBackgroundEnvironment;
}
