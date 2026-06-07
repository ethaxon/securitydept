import { describe, expect, it } from "vitest";
import {
	createDisposableStack,
	type DisposableStackTrait,
	type DisposableTrait,
	injectDisposableStackFrom,
	SimpleDisposableStack,
	StdDisposableStack,
	withDisposableStack,
} from "../disposable";

function disposable(dispose: () => void) {
	return {
		dispose,
		[Symbol.dispose]: dispose,
	};
}

describe("disposable stack", () => {
	it("disposes simple stack entries in LIFO order", () => {
		const calls: number[] = [];
		const stack = new SimpleDisposableStack();
		stack.use(disposable(() => calls.push(1)));
		stack.use(disposable(() => calls.push(2)));

		stack.dispose();
		stack.dispose();

		expect(calls).toEqual([2, 1]);
		expect(stack.disposed).toBe(true);
	});

	it("wraps a host DisposableStack when one is available", () => {
		const calls: string[] = [];
		class TestDisposableStack {
			disposed = false;
			private entries: DisposableTrait[] = [];

			use<T extends DisposableTrait>(value: T): T {
				this.entries.push(value);
				return value;
			}

			dispose(): void {
				this.disposed = true;
				for (
					let entry = this.entries.pop();
					entry;
					entry = this.entries.pop()
				) {
					entry.dispose();
				}
			}
		}

		const stack = new StdDisposableStack(TestDisposableStack);
		stack.use(disposable(() => calls.push("disposed")));
		stack.dispose();

		expect(calls).toEqual(["disposed"]);
		expect(stack.disposed).toBe(true);
		expect(createDisposableStack()).toBeDefined();
	});
});

describe("withDisposableStack", () => {
	it("injects a stack by argument index and disposes after async settlement", async () => {
		const calls: string[] = [];
		let resolve!: () => void;
		const pending = new Promise<void>((resolvePromise) => {
			resolve = resolvePromise;
		});

		class Subject {
			@withDisposableStack(0)
			async run(disposableStack?: DisposableStackTrait): Promise<void> {
				disposableStack = injectDisposableStackFrom(disposableStack);
				const value = disposable(() => calls.push("disposed"));
				disposableStack?.use(value);
				await pending;
			}
		}

		const promise = new Subject().run();
		expect(calls).toEqual([]);
		resolve();
		await promise;
		expect(calls).toEqual(["disposed"]);
	});

	it("injects a stack into an options key", () => {
		const calls: string[] = [];

		class Subject {
			@withDisposableStack(0, true)
			run(options: object = {}): void {
				injectDisposableStackFrom(options, true)?.use(
					disposable(() => calls.push("disposed")),
				);
			}
		}

		new Subject().run();
		expect(calls).toEqual(["disposed"]);
	});

	it("disposes after an async rejection", async () => {
		const calls: string[] = [];
		const failure = new Error("operation failed");

		class Subject {
			@withDisposableStack(0)
			async run(disposableStack?: DisposableStackTrait): Promise<void> {
				disposableStack = injectDisposableStackFrom(disposableStack);
				disposableStack?.use(disposable(() => calls.push("disposed")));
				throw failure;
			}
		}

		await expect(new Subject().run()).rejects.toBe(failure);
		expect(calls).toEqual(["disposed"]);
	});
});
