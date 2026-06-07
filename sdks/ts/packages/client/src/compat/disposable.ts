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

export interface DisposableStackTrait extends DisposableTrait {
	readonly disposed: boolean;
	use<T extends DisposableTrait>(disposable: T): T;
	dispose(): void;
	[SYMBOL_DISPOSE](): void;
}

export const SYMBOL_DISPOSABLE_STACK = "@@disposableStack";

export function injectDisposableStackFrom(
	arg: unknown,
	isOptions = false,
): DisposableStackTrait | undefined {
	return (
		isOptions && typeof arg === "object" && arg !== null
			? (arg as Record<PropertyKey, unknown>)[SYMBOL_DISPOSABLE_STACK]
			: arg
	) as DisposableStackTrait | undefined;
}

export class SimpleDisposableStack implements DisposableStackTrait {
	private readonly stack: DisposableTrait[] = [];
	disposed = false;

	use<T extends DisposableTrait>(disposable: T): T {
		if (this.disposed) {
			throw new ReferenceError("Disposable stack is already disposed");
		}
		this.stack.push(disposable);
		return disposable;
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		const errors: unknown[] = [];
		for (
			let disposable = this.stack.pop();
			disposable;
			disposable = this.stack.pop()
		) {
			try {
				disposable.dispose();
			} catch (error) {
				errors.push(error);
			}
		}
		if (errors.length === 1) {
			throw errors[0];
		}
		if (errors.length > 1) {
			throw new AggregateError(errors, "Failed to dispose disposable stack");
		}
	}

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}
}

interface NativeDisposableStackLike {
	readonly disposed: boolean;
	use<T extends DisposableTrait>(disposable: T): T;
	dispose(): void;
}

type NativeDisposableStackConstructor = new () => NativeDisposableStackLike;

export class StdDisposableStack implements DisposableStackTrait {
	private readonly stack: NativeDisposableStackLike;

	constructor(
		Stack: NativeDisposableStackConstructor = (
			globalThis as typeof globalThis & {
				DisposableStack: NativeDisposableStackConstructor;
			}
		).DisposableStack,
	) {
		this.stack = new Stack();
	}

	get disposed(): boolean {
		return this.stack.disposed;
	}

	use<T extends DisposableTrait>(disposable: T): T {
		return this.stack.use(disposable);
	}

	dispose(): void {
		this.stack.dispose();
	}

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}
}

export function createDisposableStack(): DisposableStackTrait {
	const Stack = (
		globalThis as typeof globalThis & {
			DisposableStack?: NativeDisposableStackConstructor;
		}
	).DisposableStack;
	return typeof Stack === "function"
		? new StdDisposableStack(Stack)
		: new SimpleDisposableStack();
}

export function withDisposableStack(index: number, isOptions = false) {
	return <TThis, TArgs extends unknown[], TReturn>(
		target: (this: TThis, ...args: TArgs) => TReturn,
		_context: ClassMethodDecoratorContext<
			TThis,
			(this: TThis, ...args: TArgs) => TReturn
		>,
	) =>
		function (this: TThis, ...args: TArgs): TReturn {
			const disposableStack = createDisposableStack();
			const injectedArgs = [...args] as unknown[];
			if (isOptions) {
				const value = injectedArgs[index];
				injectedArgs[index] = Object.assign(
					{},
					typeof value === "object" && value !== null ? value : undefined,
					{ [SYMBOL_DISPOSABLE_STACK]: disposableStack },
				);
			} else {
				injectedArgs[index] = disposableStack;
			}

			let result: TReturn;
			try {
				result = target.call(this, ...(injectedArgs as TArgs));
			} catch (error) {
				disposableStack.dispose();
				throw error;
			}

			if (
				typeof result === "object" &&
				result !== null &&
				"then" in result &&
				typeof result.then === "function"
			) {
				return Promise.resolve(result).finally(() => {
					disposableStack.dispose();
				}) as TReturn;
			}

			disposableStack.dispose();
			return result;
		};
}
