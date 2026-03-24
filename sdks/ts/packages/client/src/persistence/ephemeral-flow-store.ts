import { createJsonCodec } from "./json-codec";
import type { Codec, EphemeralFlowStore, RecordStore } from "./types";

export interface CreateEphemeralFlowStoreOptions<T> {
	store: RecordStore;
	key: string;
	codec?: Codec<T>;
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

	async function load(): Promise<T | null> {
		const raw = await options.store.get(options.key);
		return raw === null ? null : codec.decode(raw);
	}

	async function save(value: T): Promise<void> {
		await options.store.set(options.key, codec.encode(value));
	}

	async function consume(): Promise<T | null> {
		const value = await load();
		if (value !== null) {
			await options.store.remove(options.key);
		}
		return value;
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
