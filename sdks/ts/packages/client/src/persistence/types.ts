// --- Persistence abstractions ---

/** Low-level key-value record store. */
export interface RecordStore {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	remove(key: string): Promise<void>;
}

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

/** Versioned storage envelope — first-version migration support. */
export interface StoredEnvelope<T> {
	version: number;
	storedAt: number;
	expiresAt?: number;
	value: T;
}
