import { fromEventPattern } from "rxjs";
import type { EventStreamTrait } from "../../events";

export interface StorageEventTarget {
	addEventListener(type: "storage", listener: EventListener): void;
	removeEventListener(type: "storage", listener: EventListener): void;
}

export interface FromStorageEventOptions {
	storageEventTarget: StorageEventTarget;
}

/**
 * Adapt browser `storage` events into an event stream.
 */
export function fromStorageEvent(
	options: FromStorageEventOptions,
): EventStreamTrait<StorageEvent> {
	const { storageEventTarget } = options;

	return fromEventPattern(
		(handler) => {
			storageEventTarget.addEventListener("storage", handler);
		},
		(handler) => {
			storageEventTarget.removeEventListener("storage", handler);
		},
	);
}
