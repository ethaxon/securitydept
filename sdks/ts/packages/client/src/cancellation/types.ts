// --- Cancellation and disposal ---

import { type DisposableTrait, type InteropObservableTrait } from "../compat";
import { type EventStreamTrait } from "../events/types";

/** Cancelable operation handle. */
export interface CancelableHandle {
	cancel(): void;
}

/** Cooperative cancellation token — consumers check / subscribe to cancellation. */
export interface CancellationTokenTrait
	extends EventStreamTrait<unknown>,
		InteropObservableTrait<unknown> {
	readonly isCancellationRequested: boolean;
	readonly reason?: unknown;
	onCancellationRequested(listener: (reason: unknown) => void): DisposableTrait;
	readCancellationError(): unknown;
	throwIfCancellationRequested(): void;
}

/** Cancellation source — producer-side control. */
export interface CancellationTokenSourceTrait extends DisposableTrait {
	readonly token: CancellationTokenTrait;
	cancel(reason?: unknown): void;
}
