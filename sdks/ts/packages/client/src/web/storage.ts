import { type as defineType } from "arktype";
import { filter, from, map, merge } from "rxjs";
import { type EnvironmentValidators } from "../environment/types";
import { RxEventStream, RxEventSubject } from "../rx";
import {
	type StorageChangeEvent,
	StorageChangeEventOrigin,
	type SyncStorageTrait,
} from "../storage/types";
import {
	throwValidationClientError,
	validateTraitInput,
	validateWithSchemaSync,
	type WithTraitInputValidator,
} from "../validation";
import {
	fromStorageEvent,
	type StorageEventTarget,
} from "./events/from-storage";

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

const StorageEventTargetSchema = defineType({
	addEventListener: "Function",
	removeEventListener: "Function",
});

const StorageForNativeWebCreateOptionsSchema = defineType({
	storage: NativeWebStorageLikeSchema,
	storageEventTarget: StorageEventTargetSchema.or("null").or("undefined"),
	prefix: "string | undefined",
	validatorKey: "'persistentStorage' | 'sessionStorage'",
});

const StorageForNativeWebUnavailableProbeSchema = defineType({
	storage: "null | undefined",
	storageEventTarget: "unknown",
	prefix: "string | undefined",
	validatorKey: "'persistentStorage' | 'sessionStorage'",
});

export interface StorageForNativeWebCreateOptions {
	storage?: NativeWebStorageLike | null;
	storageEventTarget?: StorageEventTarget | null;
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
): SyncStorageTrait | null {
	const { validators, ...createOptions } = options;
	const global = globalThis as {
		localStorage?: NativeWebStorageLike;
		sessionStorage?: NativeWebStorageLike;
		addEventListener?: StorageEventTarget["addEventListener"];
		removeEventListener?: StorageEventTarget["removeEventListener"];
	};
	const resolvedCreateOptions = {
		storage:
			options.validatorKey === "persistentStorage"
				? (global.localStorage ?? null)
				: (global.sessionStorage ?? null),
		...createOptions,
		storageEventTarget:
			createOptions.storageEventTarget === undefined
				? typeof global.addEventListener === "function" &&
					typeof global.removeEventListener === "function"
					? (global as StorageEventTarget)
					: null
				: createOptions.storageEventTarget,
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
	const localStorageEvent = new RxEventSubject<StorageChangeEvent>();
	const externalStorageEvent = resolvedCreateOptions.storageEventTarget
		? from(
				fromStorageEvent({
					storageEventTarget: resolvedCreateOptions.storageEventTarget,
				}),
			).pipe(
				filter(
					(event) =>
						(event.storageArea === null || event.storageArea === storage) &&
						(event.key === null || event.key.startsWith(prefix)),
				),
				map(
					(event): StorageChangeEvent => ({
						origin: StorageChangeEventOrigin.External,
						key: event.key === null ? null : event.key.slice(prefix.length),
						oldValue: event.oldValue,
						newValue: event.newValue,
					}),
				),
			)
		: null;
	const storageEvent = RxEventStream.fromObservableInput(
		externalStorageEvent
			? merge(localStorageEvent, externalStorageEvent)
			: localStorageEvent,
	);

	return {
		storageEvent,
		get(key) {
			return storage.getItem(prefix + key);
		},
		set(key, value) {
			const storageKey = prefix + key;
			const oldValue = storage.getItem(storageKey);
			storage.setItem(storageKey, value);
			localStorageEvent.next({
				origin: StorageChangeEventOrigin.Local,
				key,
				oldValue,
				newValue: value,
			});
		},
		take(key) {
			const storageKey = prefix + key;
			const value = storage.getItem(storageKey);
			if (value !== null) {
				storage.removeItem(storageKey);
				localStorageEvent.next({
					origin: StorageChangeEventOrigin.Local,
					key,
					oldValue: value,
					newValue: null,
				});
			}
			return value;
		},
		remove(key) {
			const storageKey = prefix + key;
			const oldValue = storage.getItem(storageKey);
			storage.removeItem(storageKey);
			if (oldValue !== null) {
				localStorageEvent.next({
					origin: StorageChangeEventOrigin.Local,
					key,
					oldValue,
					newValue: null,
				});
			}
		},
	};
}

export function createPersistentStorageForNativeWeb(
	options: Omit<StorageForNativeWebCreateOptions, "validatorKey"> &
		WithTraitInputValidator<
			Pick<EnvironmentValidators, "persistentStorage" | "sessionStorage">
		>,
): SyncStorageTrait | null {
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
): SyncStorageTrait | null {
	return createStorageForNativeWeb({
		...options,
		validatorKey: "sessionStorage",
	});
}
