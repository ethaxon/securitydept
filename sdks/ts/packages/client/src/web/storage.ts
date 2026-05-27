import { type as defineType } from "arktype";
import { type EnvironmentValidators } from "../environment/types";
import { type StorageTrait } from "../storage/types";
import {
	throwValidationClientError,
	validateTraitInput,
	validateWithSchemaSync,
	type WithTraitInputValidator,
} from "../validation";

export interface NativeWebStorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

const NativeWebStorageLikeSchema = defineType({
	getItem: "Function",
	setItem: "Function",
	removeItem: "Function",
});

const StorageForNativeWebCreateOptionsSchema = defineType({
	storage: NativeWebStorageLikeSchema,
	prefix: "string | undefined",
	validatorKey: "'persistentStorage' | 'sessionStorage'",
});

const StorageForNativeWebUnavailableProbeSchema = defineType({
	storage: "null | undefined",
	prefix: "string | undefined",
	validatorKey: "'persistentStorage' | 'sessionStorage'",
});

export interface StorageForNativeWebCreateOptions {
	storage?: NativeWebStorageLike | null;
	prefix?: string;
	validatorKey: "persistentStorage" | "sessionStorage";
}

const DEFAULT_PERSISTENT_STORAGE_PREFIX = "securitydept.web.client:";
const DEFAULT_SESSION_STORAGE_PREFIX = "securitydept.web.client:";

export function createStorageForNativeWeb(
	options: StorageForNativeWebCreateOptions &
		WithTraitInputValidator<
			Pick<EnvironmentValidators, "persistentStorage" | "sessionStorage">
		>,
): StorageTrait | null {
	const { validators, ...createOptions } = options;
	const global = globalThis as {
		localStorage?: NativeWebStorageLike;
		sessionStorage?: NativeWebStorageLike;
	};
	const resolvedCreateOptions = {
		storage:
			options.validatorKey === "persistentStorage"
				? (global.localStorage ?? null)
				: (global.sessionStorage ?? null),
		...createOptions,
		prefix:
			createOptions.prefix ??
			(options.validatorKey === "persistentStorage"
				? DEFAULT_PERSISTENT_STORAGE_PREFIX
				: DEFAULT_SESSION_STORAGE_PREFIX),
	};
	const unavailableProbeResult = validateWithSchemaSync(
		StorageForNativeWebUnavailableProbeSchema,
		resolvedCreateOptions,
	);
	if (unavailableProbeResult.success) {
		return null;
	}
	validateTraitInput({
		value: resolvedCreateOptions,
		bundledSchema: StorageForNativeWebCreateOptionsSchema,
		validator: validators?.[options.validatorKey],
		onInvalid: (failure) =>
			throwValidationClientError({
				code: "web.storage.invalid_native_web_storage_options",
				source: "web",
				messagePrefix: `createStorageForNativeWeb could not validate ${options.validatorKey}ForNativeWebCreateOptions`,
				failure,
			}),
	});
	const storage = resolvedCreateOptions.storage as NativeWebStorageLike;
	const prefix = resolvedCreateOptions.prefix;

	return {
		async get(key) {
			return storage.getItem(prefix + key);
		},
		async set(key, value) {
			storage.setItem(prefix + key, value);
		},
		async take(key) {
			const storageKey = prefix + key;
			const value = storage.getItem(storageKey);
			if (value !== null) {
				storage.removeItem(storageKey);
			}
			return value;
		},
		async remove(key) {
			storage.removeItem(prefix + key);
		},
	};
}

export function createPersistentStorageForNativeWeb(
	options: Omit<StorageForNativeWebCreateOptions, "validatorKey"> &
		WithTraitInputValidator<
			Pick<EnvironmentValidators, "persistentStorage" | "sessionStorage">
		>,
): StorageTrait | null {
	return createStorageForNativeWeb({
		...options,
		validatorKey: "persistentStorage",
	});
}

export function createSessionStorageForNativeWeb(
	options: Omit<StorageForNativeWebCreateOptions, "validatorKey"> &
		WithTraitInputValidator<
			Pick<EnvironmentValidators, "persistentStorage" | "sessionStorage">
		>,
): StorageTrait | null {
	return createStorageForNativeWeb({
		...options,
		validatorKey: "sessionStorage",
	});
}
