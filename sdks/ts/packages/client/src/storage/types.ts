import { type as defineType } from "arktype";
import { type EventStreamTrait } from "../events";
import { SecuritydeptInjectionToken } from "../injection";

// --- Storage abstractions ---

export const StorageChangeEventOrigin = {
	Local: "local",
	External: "external",
} as const;

export type StorageChangeEventOrigin =
	(typeof StorageChangeEventOrigin)[keyof typeof StorageChangeEventOrigin];

export interface StorageChangeEvent {
	readonly origin: StorageChangeEventOrigin;
	readonly key: string | null;
	readonly oldValue: string | null;
	readonly newValue: string | null;
}

/** Low-level key-value storage trait. */
export interface StorageTrait {
	readonly storageEvent?: EventStreamTrait<StorageChangeEvent>;
	get(key: string): string | null | Promise<string | null>;
	set(key: string, value: string): void | Promise<void>;
	/**
	 * Atomically read and remove a record within the store's consistency domain.
	 */
	take?(key: string): string | null | Promise<string | null>;
	remove(key: string): void | Promise<void>;
}

/** Storage whose operations complete synchronously in the current realm. */
export interface SyncStorageTrait extends StorageTrait {
	get(key: string): string | null;
	set(key: string, value: string): void;
	take?(key: string): string | null;
	remove(key: string): void;
}

export const StorageTraitSchema = defineType({
	"storageEvent?": {
		subscribe: "Function",
	},
	get: "Function",
	set: "Function",
	take: "Function?",
	remove: "Function",
});

export const REALM_STORAGE_TRAIT_TOKEN =
	new SecuritydeptInjectionToken<SyncStorageTrait>("REALM_STORAGE_TRAIT_TOKEN");

export const PERSISTENT_STORAGE_TRAIT_TOKEN =
	new SecuritydeptInjectionToken<StorageTrait | null>(
		"PERSISTENT_STORAGE_TRAIT_TOKEN",
	);

export const SESSION_STORAGE_TRAIT_TOKEN =
	new SecuritydeptInjectionToken<StorageTrait | null>(
		"SESSION_STORAGE_TRAIT_TOKEN",
	);

/** Serialization codec for typed values. */
export interface Codec<T> {
	encode(value: T): string;
	decode(raw: string): T;
}

/** Semantic store for long-lived auth state. */
export interface PersistentAuthStore<T> {
	load(): Promise<T | null>;
	save(value: T): Promise<void>;
	clear(): Promise<void>;
}

/** Semantic store for recoverable state (survives page reload). */
export interface RecoverableStateStore<T> {
	load(): Promise<T | null>;
	save(value: T): Promise<void>;
	clear(): Promise<void>;
}

/** Semantic store for ephemeral flow state (one-time-use). */
export interface EphemeralFlowStore<T> {
	load(): Promise<T | null>;
	save(value: T): Promise<void>;
	consume(): Promise<T | null>;
	clear(): Promise<void>;
}

/** Semantic store for keyed ephemeral flow state (one-time-use per key). */
export interface KeyedEphemeralFlowStore<T> {
	load(key: string): Promise<T | null>;
	save(key: string, value: T): Promise<void>;
	take(key: string): Promise<T | null>;
	clear(key: string): Promise<void>;
}

/** Versioned storage envelope — first-version migration support. */
export interface StoredEnvelope<T> {
	version: number;
	storedAt: number;
	expiresAt?: number;
	value: T;
}
