import { afterEach, describe, expect, it, vi } from "vitest";
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

	it("adapts valid native web storage hosts", async () => {
		const hostStorage = createNativeWebStorage();
		const storage = createPersistentStorageForNativeWeb({
			storage: hostStorage,
			prefix: "test:",
		});

		expect(storage).not.toBeNull();
		await storage?.set("key", "value");
		expect(hostStorage.values.get("test:key")).toBe("value");
		await expect(storage?.get("key")).resolves.toBe("value");
		expect(storage?.take).toBeDefined();
		await expect(storage?.take?.("key")).resolves.toBe("value");
		await expect(storage?.get("key")).resolves.toBeNull();
		await storage?.set("key", "next");
		await storage?.remove("key");
		await expect(storage?.get("key")).resolves.toBeNull();
	});

	it("returns null from host-specific creators when global storage is unavailable", () => {
		vi.stubGlobal("localStorage", undefined);
		vi.stubGlobal("sessionStorage", undefined);

		expect(createPersistentStorageForNativeWeb({ prefix: "test:" })).toBeNull();
		expect(createSessionStorageForNativeWeb({ prefix: "test:" })).toBeNull();
	});
});
