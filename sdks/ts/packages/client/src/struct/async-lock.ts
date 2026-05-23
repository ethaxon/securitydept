import { createSignal, type ReadableSignalTrait } from "../signals";

export const OnceAsyncLockState = {
	Init: "init",
	Running: "running",
	Success: "success",
	Error: "error",
} as const;

export type OnceAsyncLockState =
	(typeof OnceAsyncLockState)[keyof typeof OnceAsyncLockState];

export type OnceAsyncLockInit = {
	readonly state: typeof OnceAsyncLockState.Init;
	readonly promise?: never;
};

export type OnceAsyncLockRunning = {
	readonly state: typeof OnceAsyncLockState.Running;
	readonly promise: Promise<unknown>;
};

export type OnceAsyncLockSuccess<T> = {
	readonly state: typeof OnceAsyncLockState.Success;
	readonly data: T;
};

export type OnceAsyncLockError<E> = {
	readonly state: typeof OnceAsyncLockState.Error;
	readonly error: E;
};

export type OnceAsyncLock<T, E> =
	| OnceAsyncLockInit
	| OnceAsyncLockRunning
	| OnceAsyncLockSuccess<T>
	| OnceAsyncLockError<E>;

export type OnceAsyncLockCallable<
	F extends (...args: any[]) => PromiseLike<any>,
	E = unknown,
> = F &
	OnceAsyncLock<Awaited<ReturnType<F>>, E> &
	ReadableSignalTrait<F & OnceAsyncLock<Awaited<ReturnType<F>>, E>>;

export function createOnceAsyncLockCallable<
	F extends (...args: any[]) => PromiseLike<any>,
	E = unknown,
>(fn: F): OnceAsyncLockCallable<F, E> {
	const internalStateSignal = createSignal({
		state: OnceAsyncLockState.Init,
	} as OnceAsyncLock<Awaited<ReturnType<F>>, E>);

	const coreFn = async function (
		this: any,
		...args: Parameters<F>
	): Promise<Awaited<ReturnType<F>>> {
		const internalState = internalStateSignal.get();
		if (internalState.state === OnceAsyncLockState.Running) {
			return internalState.promise as Promise<Awaited<ReturnType<F>>>;
		}
		if (internalState.state === OnceAsyncLockState.Success) {
			return internalState.data;
		}

		let resolvePromise!: (value: Awaited<ReturnType<F>>) => void;
		let rejectPromise!: (reason: any) => void;

		const promise = new Promise<Awaited<ReturnType<F>>>((res, rej) => {
			resolvePromise = res;
			rejectPromise = rej;
		});

		internalStateSignal.set({ state: OnceAsyncLockState.Running, promise });

		try {
			const result = await fn.apply(this, args);
			internalStateSignal.set({
				state: OnceAsyncLockState.Success,
				data: result,
			});
			resolvePromise(result);
			return result;
		} catch (err) {
			internalStateSignal.set({
				state: OnceAsyncLockState.Error,
				error: err as E,
			});
			rejectPromise(err);
			throw err;
		}
	};

	return new Proxy(coreFn, {
		get(target, prop, receiver) {
			// if accessing state, promise, data, error, map directly from internalState
			const internalState = internalStateSignal.get();
			if (prop in internalState) {
				return Reflect.get(internalState, prop);
			}
			if (prop === "get") {
				return Reflect.get(internalStateSignal, prop, internalStateSignal);
			}
			if (prop === "subscribe") {
				return Reflect.get(internalStateSignal, prop, internalStateSignal);
			}
			// other properties (like function's name, length, toString, etc.) retain original function behavior
			return Reflect.get(target, prop, receiver);
		},
		// intercept assignment operations to ensure state is read-only and prevent malicious or accidental modifications from outside
		set() {
			return false; // in strict mode, this will throw a TypeError, preventing modification
		},
	}) as unknown as OnceAsyncLockCallable<F, E>;
}
