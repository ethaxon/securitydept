import type { CancelableHandle, Scheduler } from "./types";

/** Default scheduler backed by platform `setTimeout`. */
export function createDefaultScheduler(): Scheduler {
	return {
		setTimeout(delayMs: number, fn: () => void): CancelableHandle {
			const id = globalThis.setTimeout(fn, delayMs);
			return {
				cancel() {
					globalThis.clearTimeout(id);
				},
			};
		},
	};
}
