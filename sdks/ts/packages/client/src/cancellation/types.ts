// --- Cancellation and disposal ---

import { type DisposableTrait, type InteropObservableTrait } from "../compat";

/** Cancelable operation handle. */
export interface CancelableHandle {
	cancel(): void;
}

export interface CancellationTokenErrorData {
	readonly cancellationError: Error;
	readonly reason: unknown;
}

/** Cooperative cancellation token — consumers check / subscribe to cancellation. */
export interface CancellationTokenTrait
	extends InteropObservableTrait<CancellationTokenErrorData> {
	readonly isCancellationRequested: boolean;
	readonly cancellationError?: Error | undefined;
	readonly reason?: unknown;
	onCancellationRequested(
		listener: (data: CancellationTokenErrorData) => void,
	): DisposableTrait;
	throwIfCancellationRequested(): void;
}

/** Cancellation source — producer-side control. */
export interface CancellationTokenSourceTrait {
	readonly token: CancellationTokenTrait;
	cancel(reason?: unknown): void;
}
