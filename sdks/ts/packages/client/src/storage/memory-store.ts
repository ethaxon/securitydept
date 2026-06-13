import { RxEventSubject } from "../rx/event";
import {
	type StorageChangeEvent,
	StorageChangeEventOrigin,
	type SyncStorageTrait,
} from "./types";

/** In-memory `SyncStorageTrait` — useful for realm state, tests, and SSR. */
export function createInMemoryRecordStore(): SyncStorageTrait {
	const store = new Map<string, string>();
	const storageEvent = new RxEventSubject<StorageChangeEvent>();

	return {
		storageEvent,
		get(key: string): string | null {
			return store.get(key) ?? null;
		},
		set(key: string, value: string): void {
			const oldValue = store.get(key) ?? null;
			store.set(key, value);
			storageEvent.next({
				origin: StorageChangeEventOrigin.Local,
				key,
				oldValue,
				newValue: value,
			});
		},
		take(key: string): string | null {
			const value = store.get(key) ?? null;
			if (value !== null) {
				store.delete(key);
				storageEvent.next({
					origin: StorageChangeEventOrigin.Local,
					key,
					oldValue: value,
					newValue: null,
				});
			}
			return value;
		},
		remove(key: string): void {
			const oldValue = store.get(key) ?? null;
			if (oldValue !== null) {
				store.delete(key);
				storageEvent.next({
					origin: StorageChangeEventOrigin.Local,
					key,
					oldValue,
					newValue: null,
				});
			}
		},
	};
}
