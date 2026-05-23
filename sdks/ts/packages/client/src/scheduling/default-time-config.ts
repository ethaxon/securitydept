import type { TimeTrait } from "./types";

export function createDefaultTimeConfig(): TimeTrait {
	return {
		now: () => Date.now(),
		setTimeout: (handler, delayMs) => globalThis.setTimeout(handler, delayMs),
		clearTimeout: (handle) => {
			globalThis.clearTimeout(
				handle as ReturnType<typeof globalThis.setTimeout>,
			);
		},
	};
}
