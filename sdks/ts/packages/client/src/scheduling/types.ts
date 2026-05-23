// --- Time capability abstraction ---

export interface TimestampProviderTrait {
	/** Return current epoch milliseconds. */
	now(): number;
}

/** Injectable time capability for host timers and deterministic tests. */
export interface TimeTrait extends TimestampProviderTrait {
	/** Return current epoch milliseconds. */
	setTimeout(handler: () => void, delayMs: number): unknown;
	clearTimeout(handle: unknown): void;
}

/** Injectable idle-callback capability for hosts that explicitly support it. */
export interface IdleCallbackTrait {
	requestIdleCallback(callback: () => void): unknown;
	cancelIdleCallback(handle: unknown): void;
}
