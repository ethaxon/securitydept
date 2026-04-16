import { createJsonCodec } from "./json-codec";
import type {
	Codec,
	EphemeralFlowStore,
	KeyedEphemeralFlowStore,
	RecordStore,
} from "./types";

export interface CreateEphemeralFlowStoreOptions<T> {
	store: RecordStore;
	key: string;
	codec?: Codec<T>;
}

export interface CreateKeyedEphemeralFlowStoreOptions<T> {
	store: RecordStore;
	keyPrefix: string;
	codec?: Codec<T>;
}

function resolveStorageKey(keyPrefix: string, key: string): string {
	return keyPrefix.length > 0 ? `${keyPrefix}:${key}` : key;
}

function requireRecordStoreTake(
	store: RecordStore,
): NonNullable<RecordStore["take"]> {
	if (!store.take) {
		throw new Error(
			"Ephemeral flow stores require RecordStore.take() for atomic single-consume semantics",
		);
	}

	return store.take.bind(store);
}

/**
 * Create a typed ephemeral flow-state store backed by a low-level `RecordStore`.
 *
 * Intended for short-lived browser/session coordination state such as pending
 * redirects or callback fragments.
 */
export function createEphemeralFlowStore<T>(
	options: CreateEphemeralFlowStoreOptions<T>,
): EphemeralFlowStore<T> {
	const codec = options.codec ?? createJsonCodec<T>();
	const storeTake = requireRecordStoreTake(options.store);

	async function load(): Promise<T | null> {
		const raw = await options.store.get(options.key);
		return raw === null ? null : codec.decode(raw);
	}

	async function save(value: T): Promise<void> {
		await options.store.set(options.key, codec.encode(value));
	}

	async function consume(): Promise<T | null> {
		const raw = await storeTake(options.key);
		return raw === null ? null : codec.decode(raw);
	}

	async function clear(): Promise<void> {
		await options.store.remove(options.key);
	}

	return {
		load,
		save,
		consume,
		clear,
	};
}

/**
 * Create a typed keyed ephemeral flow-state store backed by a low-level
 * `RecordStore`.
 *
 * Intended for short-lived browser/session coordination state where multiple
 * pending records must coexist and be consumed independently.
 */
export function createKeyedEphemeralFlowStore<T>(
	options: CreateKeyedEphemeralFlowStoreOptions<T>,
): KeyedEphemeralFlowStore<T> {
	const codec = options.codec ?? createJsonCodec<T>();
	const storeTake = requireRecordStoreTake(options.store);

	async function load(key: string): Promise<T | null> {
		const raw = await options.store.get(
			resolveStorageKey(options.keyPrefix, key),
		);
		return raw === null ? null : codec.decode(raw);
	}

	async function save(key: string, value: T): Promise<void> {
		await options.store.set(
			resolveStorageKey(options.keyPrefix, key),
			codec.encode(value),
		);
	}

	async function take(key: string): Promise<T | null> {
		const raw = await storeTake(resolveStorageKey(options.keyPrefix, key));
		return raw === null ? null : codec.decode(raw);
	}

	async function clear(key: string): Promise<void> {
		await options.store.remove(resolveStorageKey(options.keyPrefix, key));
	}

	return {
		load,
		save,
		take,
		clear,
	};
}
