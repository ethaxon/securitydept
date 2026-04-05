import { createCancellationTokenSource } from "./cancellation-token";
import type { CancellationTokenTrait } from "./types";

/**
 * Create a cancellation token that fires when ANY of the given source tokens
 * is cancelled.
 *
 * - Zero sources → returns a token that is never cancelled.
 * - One source   → returns that source directly (no allocation).
 * - N sources    → creates a linked source, subscribes to all, and cleans up
 *   subscriptions once the linked token fires.
 *
 * @example
 * const cts = createCancellationTokenSource();
 * const linked = createLinkedCancellationToken(clientRoot.token, cts.token);
 * await transport.execute({ ..., cancellationToken: linked });
 */
export function createLinkedCancellationToken(
	...sources: CancellationTokenTrait[]
): CancellationTokenTrait {
	// Zero sources — return a token that is never cancelled.
	if (sources.length === 0) {
		return createCancellationTokenSource().token;
	}

	// One source — return directly; no allocation needed.
	if (sources.length === 1) {
		return sources[0];
	}

	// Fast-path: return the first already-cancelled source immediately.
	for (const source of sources) {
		if (source.isCancellationRequested) return source;
	}

	const linked = createCancellationTokenSource();
	const subscriptions = sources.map((source) =>
		source.onCancellationRequested((reason) => linked.cancel(reason)),
	);

	// Clean up all subscriptions once the linked token fires.
	linked.token.onCancellationRequested(() => {
		for (const sub of subscriptions) sub.dispose();
	});

	return linked.token;
}
