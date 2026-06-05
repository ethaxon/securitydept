export const SYMBOL_OBSERVABLE: typeof Symbol.observable =
	typeof Symbol !== "undefined" && Symbol.observable
		? Symbol.observable
		: ("@@observable" as unknown as typeof Symbol.observable);

/** Subscription handle with explicit unsubscribe. */
export interface SubscriptionTrait {
	unsubscribe(): void;
}

/** Observer for event streams — mirrors the Observable observer pattern. */
export interface ObserverTrait<T> {
	next(value: T): void;
	error(error: unknown): void;
	complete(): void;
}

export interface SubscribableTrait<T> {
	subscribe(observer: Partial<ObserverTrait<T>>): SubscriptionTrait;
}

export interface InteropObservableTrait<T> {
	[SYMBOL_OBSERVABLE](): SubscribableTrait<T>;
}

export type WithInteropObservableTraitCompat<
	O extends InteropObservableTrait<unknown>,
	T extends O extends InteropObservableTrait<infer U> ? U : never,
> = O & InteropObservableTrait<T>;

export function isInteropObservableTrait<T>(
	value: unknown,
): value is InteropObservableTrait<T> {
	return (
		typeof value === "object" &&
		value !== null &&
		SYMBOL_OBSERVABLE in value &&
		typeof value[SYMBOL_OBSERVABLE] === "function"
	);
}
