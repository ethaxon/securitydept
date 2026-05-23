import type { CancellationTokenTrait } from "../../cancellation/types";
import { ClientError } from "../../errors/client-error";
import { ClientErrorKind, ClientErrorSource } from "../../errors/types";
import { fromAbortSignal } from "../../events";
import {
	createAbortSignalBridge,
	normalizeAbortError,
} from "../../std/cancellation";

export type { AbortSignalBridge } from "../../std/cancellation";

/**
 * Bridge a web `AbortSignal` back into the foundation cancellation contract.
 *
 * This is the canonical consumer-side path for browser hosts that receive an
 * `AbortSignal` from framework/runtime APIs (for example React Query queryFns)
 * but need to call SDK surfaces that accept `CancellationTokenTrait`.
 */
export function createCancellationTokenFromAbortSignal(
	signal?: AbortSignal,
): CancellationTokenTrait | undefined {
	if (!signal) {
		return undefined;
	}

	return {
		get isCancellationRequested() {
			return signal.aborted;
		},
		get reason() {
			return signal.reason;
		},
		onCancellationRequested(listener: (reason: unknown) => void) {
			const subscription = fromAbortSignal({
				signal,
				emitIfAborted: true,
			}).subscribe({
				next: listener,
			});
			return {
				dispose() {
					subscription.unsubscribe();
				},
			};
		},
		throwIfCancellationRequested() {
			if (signal.aborted) {
				throw new ClientError({
					kind: ClientErrorKind.Cancelled,
					message: "Request was cancelled via AbortSignal",
					code: "client.cancelled",
					source: ClientErrorSource.Transport,
					cause: signal.reason,
				});
			}
		},
	};
}

export { createAbortSignalBridge, normalizeAbortError };
