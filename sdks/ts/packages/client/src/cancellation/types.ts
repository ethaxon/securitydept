// --- Cancellation and disposal ---

import { type DisposableTrait, type InteropObservableTrait } from "../compat";
import { type ClientError } from "../errors";

/** Cancelable operation handle. */
export interface CancelableHandle {
	cancel(): void;
}

export interface CancellationTokenErrorData {
	readonly cancellationError: ClientError;
	readonly reason: unknown;
}

/** Cooperative cancellation token — consumers check / subscribe to cancellation. */
export interface CancellationTokenTrait
	extends InteropObservableTrait<CancellationTokenErrorData> {
	readonly isCancellationRequested: boolean;
	readonly cancellationError?: ClientError | undefined;
	readonly reason?: unknown;
	onCancellationRequested(
		listener: (data: CancellationTokenErrorData) => void,
	): DisposableTrait;
	throwIfCancellationRequested(): void;
}

export interface CancellationTokenOptions {
	cancellationToken?: CancellationTokenTrait;
}

/** Cancellation source — producer-side control. */
export interface CancellationTokenSourceTrait {
	readonly token: CancellationTokenTrait;
	cancel(reason?: unknown): void;
}
