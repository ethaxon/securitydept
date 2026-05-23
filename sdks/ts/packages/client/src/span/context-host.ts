import type { SpanContextHostTrait, SpanTrait } from "./types";

export function createSpanContextHost(): SpanContextHostTrait {
	let currentSpan: SpanTrait | undefined;

	return {
		currentSpan() {
			return currentSpan;
		},
		runWithSpan(span, fn) {
			const previousSpan = currentSpan;
			currentSpan = span;
			try {
				const result = fn();
				if (result instanceof Promise) {
					return result.finally(() => {
						currentSpan = previousSpan;
					});
				}
				currentSpan = previousSpan;
				return result;
			} catch (error) {
				currentSpan = previousSpan;
				throw error;
			}
		},
	};
}
