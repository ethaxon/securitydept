import type { Clock } from "./types";

/** Default clock backed by `Date.now()`. */
export function createDefaultClock(): Clock {
	return {
		now() {
			return Date.now();
		},
	};
}
