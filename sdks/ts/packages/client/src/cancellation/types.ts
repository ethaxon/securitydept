// --- Cancellation and disposal ---
/** Cancelable operation handle. */
export interface CancelableHandle {
	cancel(): void;
}

/** Cooperative cancellation token — consumers check / subscribe to cancellation. */
export interface CancellationTokenTrait {
	readonly isCancellationRequested: boolean;
	readonly reason?: unknown;
	onCancellationRequested(listener: (reason: unknown) => void): Disposable;
	throwIfCancellationRequested(): void;
}

/** Cancellation source — producer-side control. */
export interface CancellationTokenSourceTrait extends Disposable {
	readonly token: CancellationTokenTrait;
	cancel(reason?: unknown): void;
}
