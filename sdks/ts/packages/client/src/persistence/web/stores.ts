import type { StorageTrait } from "../types";

/**
 * `StorageTrait` backed by `localStorage`.
 * @param prefix Optional key prefix to isolate the keyspace.
 */
export function createLocalStorageStore(prefix = ""): StorageTrait {
	return {
		async get(key: string): Promise<string | null> {
			return globalThis.localStorage.getItem(prefix + key);
		},
		async set(key: string, value: string): Promise<void> {
			globalThis.localStorage.setItem(prefix + key, value);
		},
		async take(key: string): Promise<string | null> {
			const storageKey = prefix + key;
			const value = globalThis.localStorage.getItem(storageKey);
			if (value !== null) {
				globalThis.localStorage.removeItem(storageKey);
			}
			return value;
		},
		async remove(key: string): Promise<void> {
			globalThis.localStorage.removeItem(prefix + key);
		},
	};
}

/**
 * `StorageTrait` backed by `sessionStorage`.
 * @param prefix Optional key prefix to isolate the keyspace.
 */
export function createSessionStorageStore(prefix = ""): StorageTrait {
	return {
		async get(key: string): Promise<string | null> {
			return globalThis.sessionStorage.getItem(prefix + key);
		},
		async set(key: string, value: string): Promise<void> {
			globalThis.sessionStorage.setItem(prefix + key, value);
		},
		async take(key: string): Promise<string | null> {
			const storageKey = prefix + key;
			const value = globalThis.sessionStorage.getItem(storageKey);
			if (value !== null) {
				globalThis.sessionStorage.removeItem(storageKey);
			}
			return value;
		},
		async remove(key: string): Promise<void> {
			globalThis.sessionStorage.removeItem(prefix + key);
		},
	};
}
