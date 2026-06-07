import { createJsonCodec } from "./json-codec";
import {
	type Codec,
	type EphemeralFlowStore,
	type KeyedEphemeralFlowStore,
	type StorageTrait,
} from "./types";

export interface CreateEphemeralFlowStoreOptions<T> {
	store: StorageTrait;
	key: string;
	codec?: Codec<T>;
}

export interface CreateKeyedEphemeralFlowStoreOptions<T> {
	store: StorageTrait;
	keyPrefix: string;
	codec?: Codec<T>;
}

function resolveStorageKey(keyPrefix: string, key: string): string {
	return keyPrefix.length > 0 ? `${keyPrefix}:${key}` : key;
}

function requireRecordStoreTake(
	store: StorageTrait,
): NonNullable<StorageTrait["take"]> {
	if (!store.take) {
		throw new ClientError({
			kind: ClientErrorKind.Configuration,
			code: "storage.ephemeral.take_unavailable",
			message:
				"Ephemeral flow stores require StorageTrait.take() for atomic single-consume semantics",
			source: "storage.ephemeral",
		});
	}

	return store.take.bind(store);
}

async function executeStorageOperation<T>(
	operation: () => Promise<T>,
): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof ClientError) {
			throw error;
		}
		throw new ClientError({
			kind: ClientErrorKind.Storage,
			code: "storage.ephemeral.io_failed",
			message: "The ephemeral flow store operation failed",
			source: "storage.ephemeral",
			cause: error,
		});
	}
}

function decodeStoredValue<T>(codec: Codec<T>, value: string): T {
	try {
		return codec.decode(value);
	} catch (error) {
		throw new ClientError({
			kind: ClientErrorKind.Protocol,
			code: "storage.ephemeral.invalid_payload",
			message: "The ephemeral flow store payload is invalid",
			source: "storage.ephemeral",
			cause: error,
		});
	}
}

/**
 * Create a typed ephemeral flow-state store backed by a low-level `StorageTrait`.
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
		const raw = await executeStorageOperation(() =>
			options.store.get(options.key),
		);
		return raw === null ? null : decodeStoredValue(codec, raw);
	}

	async function save(value: T): Promise<void> {
		await executeStorageOperation(() =>
			options.store.set(options.key, codec.encode(value)),
		);
	}

	async function consume(): Promise<T | null> {
		const raw = await executeStorageOperation(() => storeTake(options.key));
		return raw === null ? null : decodeStoredValue(codec, raw);
	}

	async function clear(): Promise<void> {
		await executeStorageOperation(() => options.store.remove(options.key));
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
 * `StorageTrait`.
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
		const raw = await executeStorageOperation(() =>
			options.store.get(resolveStorageKey(options.keyPrefix, key)),
		);
		return raw === null ? null : decodeStoredValue(codec, raw);
	}

	async function save(key: string, value: T): Promise<void> {
		await executeStorageOperation(() =>
			options.store.set(
				resolveStorageKey(options.keyPrefix, key),
				codec.encode(value),
			),
		);
	}

	async function take(key: string): Promise<T | null> {
		const raw = await executeStorageOperation(() =>
			storeTake(resolveStorageKey(options.keyPrefix, key)),
		);
		return raw === null ? null : decodeStoredValue(codec, raw);
	}

	async function clear(key: string): Promise<void> {
		await executeStorageOperation(() =>
			options.store.remove(resolveStorageKey(options.keyPrefix, key)),
		);
	}

	return {
		load,
		save,
		take,
		clear,
	};
}

import { ClientError, ClientErrorKind } from "../errors";
