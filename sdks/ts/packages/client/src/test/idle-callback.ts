import { type IdleCallbackTrait } from "../scheduling/types";

export interface TestIdleCallbackTrait extends IdleCallbackTrait {
	flush(): void;
	get pendingCount(): number;
}

export function createIdleCallbackForTest(): TestIdleCallbackTrait {
	let nextId = 1;
	const callbacks = new Map<number, () => void>();
	return {
		requestIdleCallback(callback) {
			const id = nextId++;
			callbacks.set(id, callback);
			return id;
		},
		cancelIdleCallback(handle) {
			if (typeof handle === "number") {
				callbacks.delete(handle);
			}
		},
		flush() {
			const ready = [...callbacks.entries()];
			callbacks.clear();
			for (const [, callback] of ready) {
				callback();
			}
		},
		get pendingCount() {
			return callbacks.size;
		},
	};
}
