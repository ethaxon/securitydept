// --- Cancellation and disposal ---

/** Disposable resource handle. */
export interface DisposableTrait {
	dispose(): void;
}

/** Cancelable operation handle. */
export interface CancelableHandle {
	cancel(): void;
}

/** Cooperative cancellation token — consumers check / subscribe to cancellation. */
export interface CancellationTokenTrait {
	readonly isCancellationRequested: boolean;
	readonly reason?: unknown;
	onCancellationRequested(listener: (reason: unknown) => void): DisposableTrait;
	throwIfCancellationRequested(): void;
}

/** Cancellation source — producer-side control. */
export interface CancellationTokenSourceTrait extends DisposableTrait {
	readonly token: CancellationTokenTrait;
	cancel(reason?: unknown): void;
}
