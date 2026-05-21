/**
 * Default idle scheduler backed by `requestIdleCallback` with a
 * `setTimeout(0)` fallback on hosts that do not expose it.
 */
export function createDefaultIdleScheduler(): (
	callback: () => void,
) => () => void {
	return (callback: () => void) => {
		const ric = (
			globalThis as { requestIdleCallback?: (cb: () => void) => number }
		).requestIdleCallback;
		const cic = (globalThis as { cancelIdleCallback?: (h: number) => void })
			.cancelIdleCallback;
		if (typeof ric === "function") {
			const handle = ric(callback);
			return () => {
				if (typeof cic === "function") {
					cic(handle);
				}
			};
		}

		const handle = globalThis.setTimeout(callback, 0);
		return () => globalThis.clearTimeout(handle);
	};
}
