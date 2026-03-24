import type { RecordStore } from "../types";

/**
 * `RecordStore` backed by `localStorage`.
 * @param prefix Optional key prefix to isolate the keyspace.
 */
export function createLocalStorageStore(prefix = ""): RecordStore {
	return {
		async get(key: string): Promise<string | null> {
			return globalThis.localStorage.getItem(prefix + key);
		},
		async set(key: string, value: string): Promise<void> {
			globalThis.localStorage.setItem(prefix + key, value);
		},
		async remove(key: string): Promise<void> {
			globalThis.localStorage.removeItem(prefix + key);
		},
	};
}

/**
 * `RecordStore` backed by `sessionStorage`.
 * @param prefix Optional key prefix to isolate the keyspace.
 */
export function createSessionStorageStore(prefix = ""): RecordStore {
	return {
		async get(key: string): Promise<string | null> {
			return globalThis.sessionStorage.getItem(prefix + key);
		},
		async set(key: string, value: string): Promise<void> {
			globalThis.sessionStorage.setItem(prefix + key, value);
		},
		async remove(key: string): Promise<void> {
			globalThis.sessionStorage.removeItem(prefix + key);
		},
	};
}
