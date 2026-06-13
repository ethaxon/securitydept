import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type StorageChangeEvent,
	StorageChangeEventOrigin,
} from "../../storage";
import {
	createPersistentStorageForNativeWeb,
	createSessionStorageForNativeWeb,
	type NativeWebStorageLike,
} from "../storage";

function createNativeWebStorage(): NativeWebStorageLike & {
	readonly values: Map<string, string>;
} {
	const values = new Map<string, string>();
	return {
		values,
		getItem(key) {
			return values.get(key) ?? null;
		},
		setItem(key, value) {
			values.set(key, value);
		},
		removeItem(key) {
			values.delete(key);
		},
	};
}

describe("native web storage adapter", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns null when persistent storage is unavailable", () => {
		expect(createPersistentStorageForNativeWeb({ storage: null })).toBeNull();
	});

	it("returns null when session storage is unavailable", () => {
		expect(createSessionStorageForNativeWeb({ storage: null })).toBeNull();
	});

	it("returns null when default global storage is unavailable", () => {
		expect(
			createPersistentStorageForNativeWeb({ storage: undefined }),
		).toBeNull();
		expect(createSessionStorageForNativeWeb({ storage: undefined })).toBeNull();
	});

	it("throws when storage host looks present but fails the contract", () => {
		expect(() =>
			createPersistentStorageForNativeWeb({
				storage: { getItem() {} } as never,
			}),
		).toThrow(/createStorageForNativeWeb could not validate/);
	});

	it("adapts valid native web storage hosts synchronously", () => {
		const hostStorage = createNativeWebStorage();
		const storage = createPersistentStorageForNativeWeb({
			storage: hostStorage,
			prefix: "test:",
		});

		expect(storage).not.toBeNull();
		storage?.set("key", "value");
		expect(hostStorage.values.get("test:key")).toBe("value");
		expect(storage?.get("key")).toBe("value");
		expect(storage?.take).toBeDefined();
		expect(storage?.take?.("key")).toBe("value");
		expect(storage?.get("key")).toBeNull();
		storage?.set("key", "next");
		storage?.remove("key");
		expect(storage?.get("key")).toBeNull();
	});

	it("returns null from host-specific creators when global storage is unavailable", () => {
		vi.stubGlobal("localStorage", undefined);
		vi.stubGlobal("sessionStorage", undefined);

		expect(createPersistentStorageForNativeWeb({ prefix: "test:" })).toBeNull();
		expect(createSessionStorageForNativeWeb({ prefix: "test:" })).toBeNull();
	});

	it("emits logical local and matching external storage changes", () => {
		const hostStorage = createNativeWebStorage();
		let storageHandler: EventListener | undefined;
		const storage = createPersistentStorageForNativeWeb({
			storage: hostStorage,
			prefix: "test:",
			storageEventTarget: {
				addEventListener(_type, listener) {
					storageHandler = listener;
				},
				removeEventListener() {
					storageHandler = undefined;
				},
			},
		});
		const events: StorageChangeEvent[] = [];
		const subscription = storage?.storageEvent?.subscribe({
			next: (event) => events.push(event),
		});

		storage?.set("local", "value");
		storageHandler?.({
			key: "test:remote",
			oldValue: "before",
			newValue: "after",
			storageArea: hostStorage,
		} as unknown as StorageEvent);
		storageHandler?.({
			key: "other:remote",
			oldValue: null,
			newValue: "ignored",
			storageArea: hostStorage,
		} as unknown as StorageEvent);

		expect(events).toEqual([
			{
				origin: StorageChangeEventOrigin.Local,
				key: "local",
				oldValue: null,
				newValue: "value",
			},
			{
				origin: StorageChangeEventOrigin.External,
				key: "remote",
				oldValue: "before",
				newValue: "after",
			},
		]);
		subscription?.unsubscribe();
	});
});
