// --- Scheduling and clock abstractions ---

/** Wall clock abstraction — injectable for testing. */
export interface Clock {
	/** Return current epoch milliseconds. */
	now(): number;
}

/** Cancelable scheduled task handle. */
export interface CancelableHandle {
	cancel(): void;
}

/** Scheduler abstraction — decoupled from platform timers. */
export interface Scheduler {
	setTimeout(delayMs: number, fn: () => void): CancelableHandle;
}
