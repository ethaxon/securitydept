import type { LoggerTrait } from "./types";

/** No-op logger — default when no logger is provided. */
export function createNoopLogger(): LoggerTrait {
	return {
		log() {},
	};
}
