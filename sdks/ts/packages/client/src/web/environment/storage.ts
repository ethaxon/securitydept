import type { EnvironmentValidators } from "../../environment/validators";
import { validateEnvTraitInput } from "../../environment/validators";
import type { StorageTrait } from "../../persistence/types";

export interface NativeWebStorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export interface CreateStorageForNativeWebOptions {
	storage?: NativeWebStorageLike | null;
	prefix?: string;
	validators?: Pick<
		EnvironmentValidators,
		"persistentStorage" | "sessionStorage"
	>;
	validatorKey: "persistentStorage" | "sessionStorage";
}

const DEFAULT_PERSISTENT_STORAGE_PREFIX = "securitydept.web.client:";
const DEFAULT_SESSION_STORAGE_PREFIX = "securitydept.web.client:";

export function createStorageForNativeWeb(
	options: CreateStorageForNativeWebOptions,
): StorageTrait {
	const storage = options.storage;
	if (!storage) {
		throw new Error("createStorageForNativeWeb requires explicit storage.");
	}
	validateEnvTraitInput({
		traitName: options.validatorKey,
		hostAdapter: "createStorageForNativeWeb",
		value: storage,
		validator: options.validators?.[options.validatorKey],
		bundleValidate: (value) =>
			typeof (value as NativeWebStorageLike).getItem === "function" &&
			typeof (value as NativeWebStorageLike).setItem === "function" &&
			typeof (value as NativeWebStorageLike).removeItem === "function",
	});
	const prefix =
		options.prefix ??
		(options.validatorKey === "persistentStorage"
			? DEFAULT_PERSISTENT_STORAGE_PREFIX
			: DEFAULT_SESSION_STORAGE_PREFIX);
	const trait: StorageTrait = {
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
	return trait;
}

export function createPersistentStorageForNativeWeb(
	options: Omit<CreateStorageForNativeWebOptions, "validatorKey">,
): StorageTrait {
	return createStorageForNativeWeb({
		...options,
		validatorKey: "persistentStorage",
	});
}

export function createSessionStorageForNativeWeb(
	options: Omit<CreateStorageForNativeWebOptions, "validatorKey">,
): StorageTrait {
	return createStorageForNativeWeb({
		...options,
		validatorKey: "sessionStorage",
	});
}
