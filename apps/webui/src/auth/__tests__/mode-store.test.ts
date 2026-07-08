import {
	ClientErrorKind,
	createInMemoryRecordStore,
	ResourceErrorCode,
	ResourceStatus,
	type StorageChangeEvent,
	StorageChangeEventOrigin,
	type StorageTrait,
} from "@securitydept/client";
import { RxEventSubject } from "@securitydept/client/rx";
import { describe, expect, it, vi } from "vitest";
import {
	AUTH_MODE_STORAGE_KEY,
	AuthModeStoreErrorCode,
	createAuthModeStore,
} from "../mode-store";
import { AuthContextMode } from "../model";

describe("AuthModeStore", () => {
	it("waits for persistent hydration", async () => {
		let resolveRead: (value: string | null) => void = () => undefined;
		const persistentStorage: StorageTrait = {
			get: () =>
				new Promise<string | null>((resolve) => {
					resolveRead = resolve;
				}),
			set: () => undefined,
			remove: () => undefined,
		};
		using store = createAuthModeStore({ persistentStorage });

		expect(store.mode.snapshot.get()).toEqual({
			status: ResourceStatus.Loading,
		});
		resolveRead(AuthContextMode.Basic);

		await expect(store.mode.whenValue()).resolves.toBe(AuthContextMode.Basic);
	});

	it("resolves an unavailable mode and reports persistence read failures", async () => {
		const persistentStorage: StorageTrait = {
			get: () => {
				throw new Error("offline");
			},
			set: () => undefined,
			remove: () => undefined,
		};
		using store = createAuthModeStore({ persistentStorage });
		const errors: unknown[] = [];
		const subscription = store.errors.subscribe({
			next: (error) => errors.push(error),
		});

		await expect(store.mode.whenValue()).resolves.toBeNull();
		expect(errors).toEqual([
			expect.objectContaining({
				kind: ClientErrorKind.Storage,
				code: AuthModeStoreErrorCode.PersistenceReadFailed,
			}),
		]);
		subscription.unsubscribe();
	});

	it("does not replay persistence errors to late subscribers", async () => {
		using store = createAuthModeStore({
			persistentStorage: {
				get: async () => {
					throw new Error("offline");
				},
				set: () => undefined,
				remove: () => undefined,
			},
		});
		await store.mode.whenValue();
		const errors: unknown[] = [];

		store.errors.subscribe({ next: (error) => errors.push(error) });

		expect(errors).toEqual([]);
	});

	it("treats an invalid persisted mode as unavailable", async () => {
		const persistentStorage = createInMemoryRecordStore();
		persistentStorage.set(AUTH_MODE_STORAGE_KEY, "unsupported");
		using store = createAuthModeStore({ persistentStorage });
		const errors: unknown[] = [];
		const subscription = store.errors.subscribe({
			next: (error) => errors.push(error),
		});

		await expect(store.mode.whenValue()).resolves.toBeNull();
		expect(errors).toContainEqual(
			expect.objectContaining({
				kind: ClientErrorKind.Protocol,
				code: AuthModeStoreErrorCode.InvalidStoredMode,
			}),
		);
		await vi.waitFor(() => {
			expect(persistentStorage.get(AUTH_MODE_STORAGE_KEY)).toBeNull();
		});
		subscription.unsubscribe();
	});

	it("keeps the mode when a background persistence write fails", async () => {
		const persistentStorage: StorageTrait = {
			get: () => null,
			set: async () => {
				throw new Error("quota exceeded");
			},
			remove: () => undefined,
		};
		using store = createAuthModeStore({ persistentStorage });
		const errors: unknown[] = [];
		const subscription = store.errors.subscribe({
			next: (error) => errors.push(error),
		});
		await store.mode.whenValue();

		store.set(AuthContextMode.Session);

		expect(store.mode.value.get()).toBe(AuthContextMode.Session);
		await vi.waitFor(() => {
			expect(errors).toContainEqual(
				expect.objectContaining({
					code: AuthModeStoreErrorCode.PersistenceWriteFailed,
				}),
			);
		});
		subscription.unsubscribe();
	});

	it("executes synchronous persistence operations without a microtask delay", async () => {
		const persistentSet = vi.fn();
		using store = createAuthModeStore({
			persistentStorage: {
				get: () => null,
				set: persistentSet,
				remove: () => undefined,
			},
		});
		await store.mode.whenValue();

		store.set(AuthContextMode.Session);

		expect(persistentSet).toHaveBeenCalledWith(
			AUTH_MODE_STORAGE_KEY,
			AuthContextMode.Session,
		);
	});

	it("rejects writes while hydration is pending", async () => {
		let resolveRead: (value: string | null) => void = () => undefined;
		const persistentStorage: StorageTrait = {
			get: () =>
				new Promise<string | null>((resolve) => {
					resolveRead = resolve;
				}),
			set: () => undefined,
			remove: () => undefined,
		};
		using store = createAuthModeStore({ persistentStorage });

		expect(() => store.set(AuthContextMode.TokenSetFrontend)).toThrow(
			expect.objectContaining({ code: ResourceErrorCode.ValueUnavailable }),
		);
		expect(() => store.clear()).toThrow(
			expect.objectContaining({ code: ResourceErrorCode.ValueUnavailable }),
		);
		resolveRead(null);
		await store.mode.whenValue();
	});

	it("queues persistence events until hydration resolves", async () => {
		let resolveRead: (value: string | null) => void = () => undefined;
		const storageEvent = new RxEventSubject<StorageChangeEvent>();
		const persistentStorage: StorageTrait = {
			storageEvent,
			get: () =>
				new Promise<string | null>((resolve) => {
					resolveRead = resolve;
				}),
			set: () => undefined,
			remove: () => undefined,
		};
		using store = createAuthModeStore({ persistentStorage });

		storageEvent.next({
			origin: StorageChangeEventOrigin.External,
			key: AUTH_MODE_STORAGE_KEY,
			oldValue: null,
			newValue: AuthContextMode.Basic,
		});
		expect(store.mode.snapshot.get()).toEqual({
			status: ResourceStatus.Loading,
		});
		resolveRead(AuthContextMode.Session);

		await vi.waitFor(() => {
			expect(store.mode.value.get()).toBe(AuthContextMode.Basic);
		});
	});

	it("serializes background persistence commands", async () => {
		const writes: AuthContextMode[] = [];
		const resolvers: Array<() => void> = [];
		const persistentStorage: StorageTrait = {
			get: () => null,
			set: (_key, value) => {
				writes.push(value as AuthContextMode);
				return new Promise<void>((resolve) => resolvers.push(resolve));
			},
			remove: () => undefined,
		};
		using store = createAuthModeStore({ persistentStorage });
		await store.mode.whenValue();

		store.set(AuthContextMode.Session);
		store.set(AuthContextMode.Basic);
		await vi.waitFor(() => expect(writes).toEqual([AuthContextMode.Session]));
		resolvers.shift()?.();
		await vi.waitFor(() =>
			expect(writes).toEqual([AuthContextMode.Session, AuthContextMode.Basic]),
		);
		resolvers.shift()?.();
	});

	it("ignores local persistence events and mirrors external changes", async () => {
		const storageEvent = new RxEventSubject<StorageChangeEvent>();
		const persistentStorage: StorageTrait = {
			storageEvent,
			get: () => null,
			set: () => undefined,
			remove: () => undefined,
		};
		using store = createAuthModeStore({ persistentStorage });
		await store.mode.whenValue();

		storageEvent.next({
			origin: StorageChangeEventOrigin.Local,
			key: AUTH_MODE_STORAGE_KEY,
			oldValue: null,
			newValue: AuthContextMode.Session,
		});
		expect(store.mode.value.get()).toBeNull();

		storageEvent.next({
			origin: StorageChangeEventOrigin.External,
			key: AUTH_MODE_STORAGE_KEY,
			oldValue: AuthContextMode.Session,
			newValue: AuthContextMode.TokenSetBackend,
		});

		await vi.waitFor(() => {
			expect(store.mode.value.get()).toBe(AuthContextMode.TokenSetBackend);
		});
	});
});
