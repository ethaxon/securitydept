import type { RecordStore } from "./types";

/** In-memory `RecordStore` — useful for tests and SSR. */
export function createInMemoryRecordStore(): RecordStore {
	const store = new Map<string, string>();

	return {
		async get(key: string): Promise<string | null> {
			return store.get(key) ?? null;
		},
		async set(key: string, value: string): Promise<void> {
			store.set(key, value);
		},
		async take(key: string): Promise<string | null> {
			const value = store.get(key) ?? null;
			if (value !== null) {
				store.delete(key);
			}
			return value;
		},
		async remove(key: string): Promise<void> {
			store.delete(key);
		},
	};
}
