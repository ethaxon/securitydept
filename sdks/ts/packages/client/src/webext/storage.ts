import { type as defineType } from "arktype";
import { type EnvironmentValidators } from "../environment/types";
import { type StorageTrait } from "../storage/types";
import {
	throwValidationClientError,
	validateTraitInput,
	validateWithSchemaSync,
	type WithTraitInputValidator,
} from "../validation";

export interface WebExtStorageAreaLike {
	get(key: string): Promise<Record<string, unknown>> | Record<string, unknown>;
	set(entries: Record<string, unknown>): Promise<void> | void;
	remove(key: string): Promise<void> | void;
}

export interface WebExtStorageBrowserLike {
	storage?: {
		local?: WebExtStorageAreaLike;
		session?: WebExtStorageAreaLike;
	};
}

export interface StorageForWebExtCreateOptions {
	browser?: WebExtStorageBrowserLike | null;
	storageArea?: WebExtStorageAreaLike | null;
	prefix?: string;
	validatorKey: "persistentStorage" | "sessionStorage";
}

const WebExtStorageAreaLikeSchema = defineType({
	get: "Function",
	set: "Function",
	remove: "Function",
});

const StorageForWebExtCreateOptionsSchema = defineType({
	storageArea: WebExtStorageAreaLikeSchema,
	prefix: "string | undefined",
	validatorKey: "'persistentStorage' | 'sessionStorage'",
});

const StorageForWebExtUnavailableProbeSchema = defineType({
	storageArea: "null | undefined",
	prefix: "string | undefined",
	validatorKey: "'persistentStorage' | 'sessionStorage'",
});

const DEFAULT_PERSISTENT_STORAGE_PREFIX = "securitydept.webext.client:";
const DEFAULT_SESSION_STORAGE_PREFIX = "securitydept.webext.client:";

export function createStorageForWebExt(
	options: StorageForWebExtCreateOptions &
		WithTraitInputValidator<
			Pick<EnvironmentValidators, "persistentStorage" | "sessionStorage">
		>,
): StorageTrait | null {
	const { validators, browser: _browser, ...createOptions } = options;
	const global = globalThis as { browser?: WebExtStorageBrowserLike };
	const browser = Object.hasOwn(options, "browser")
		? (options.browser ?? null)
		: (global.browser ?? null);
	const storageArea = Object.hasOwn(options, "storageArea")
		? (options.storageArea ?? null)
		: options.validatorKey === "persistentStorage"
			? (browser?.storage?.local ?? null)
			: (browser?.storage?.session ?? null);
	const resolvedCreateOptions = {
		...createOptions,
		storageArea,
		prefix:
			createOptions.prefix ??
			(options.validatorKey === "persistentStorage"
				? DEFAULT_PERSISTENT_STORAGE_PREFIX
				: DEFAULT_SESSION_STORAGE_PREFIX),
	};
	const unavailableProbeResult = validateWithSchemaSync(
		StorageForWebExtUnavailableProbeSchema,
		resolvedCreateOptions,
	);
	if (unavailableProbeResult.success) {
		return null;
	}
	validateTraitInput({
		value: resolvedCreateOptions,
		bundledSchema: StorageForWebExtCreateOptionsSchema,
		validator: validators?.[options.validatorKey],
		onInvalid: (failure) =>
			throwValidationClientError({
				code: "webext.storage.invalid_storage_options",
				source: "webext",
				messagePrefix: `createStorageForWebExt could not validate ${options.validatorKey}ForWebExtCreateOptions`,
				failure,
			}),
	});
	const storage = resolvedCreateOptions.storageArea as WebExtStorageAreaLike;
	const prefix = resolvedCreateOptions.prefix;

	return {
		async get(key) {
			const result = await storage.get(prefix + key);
			const value = result?.[prefix + key];
			return typeof value === "string" ? value : null;
		},
		async set(key, value) {
			await storage.set({ [prefix + key]: value });
		},
		async take(key) {
			const storageKey = prefix + key;
			const result = await storage.get(storageKey);
			const value = result?.[storageKey];
			if (typeof value === "string") {
				await storage.remove(storageKey);
				return value;
			}
			return null;
		},
		async remove(key) {
			await storage.remove(prefix + key);
		},
	};
}

export function createPersistentStorageForWebExt(
	options: Omit<StorageForWebExtCreateOptions, "validatorKey"> &
		WithTraitInputValidator<
			Pick<EnvironmentValidators, "persistentStorage" | "sessionStorage">
		> = {},
): StorageTrait | null {
	return createStorageForWebExt({
		...options,
		validatorKey: "persistentStorage",
	});
}

export function createSessionStorageForWebExt(
	options: Omit<StorageForWebExtCreateOptions, "validatorKey"> &
		WithTraitInputValidator<
			Pick<EnvironmentValidators, "persistentStorage" | "sessionStorage">
		> = {},
): StorageTrait | null {
	return createStorageForWebExt({
		...options,
		validatorKey: "sessionStorage",
	});
}
