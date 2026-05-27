export const SYMBOL_DISPOSE: typeof Symbol.dispose =
	typeof Symbol !== "undefined" && Symbol.dispose
		? Symbol.dispose
		: ("@@dispose" as unknown as typeof Symbol.dispose);

export interface DisposableTrait {
	dispose(): void;
	[SYMBOL_DISPOSE](): void;
}

export const SYMBOL_ASYNC_DISPOSE: typeof Symbol.asyncDispose =
	typeof Symbol !== "undefined" && Symbol.asyncDispose
		? Symbol.asyncDispose
		: ("@@asyncDispose" as unknown as typeof Symbol.asyncDispose);

export interface AsyncDisposableTrait {
	dispose(): Promise<void>;
	[SYMBOL_ASYNC_DISPOSE](): Promise<void>;
}
