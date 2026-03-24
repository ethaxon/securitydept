import { describe, expect, it } from "vitest";
import {
	createEventStream,
	filter,
	map,
	merge,
	pipe,
	takeUntil,
} from "../../events/index";

describe("createEventStream", () => {
	it("should emit values to subscriber", () => {
		const values: number[] = [];
		const stream = createEventStream<number>((observer) => {
			observer.next?.(1);
			observer.next?.(2);
			observer.complete?.();
		});
		stream.subscribe({ next: (v) => values.push(v) });
		expect(values).toEqual([1, 2]);
	});

	it("should call teardown on unsubscribe", () => {
		let tornDown = false;
		const stream = createEventStream<number>(() => {
			return () => {
				tornDown = true;
			};
		});
		const sub = stream.subscribe({});
		sub.unsubscribe();
		expect(tornDown).toBe(true);
	});

	it("should not emit after complete", () => {
		const values: number[] = [];
		const stream = createEventStream<number>((observer) => {
			observer.next?.(1);
			observer.complete?.();
			observer.next?.(2);
		});
		stream.subscribe({ next: (v) => values.push(v) });
		expect(values).toEqual([1]);
	});
});

describe("operators", () => {
	it("map should transform values", () => {
		const values: number[] = [];
		const source = createEventStream<number>((observer) => {
			observer.next?.(1);
			observer.next?.(2);
			observer.complete?.();
		});
		const doubled = pipe(
			source,
			map((x) => x * 2),
		);
		doubled.subscribe({ next: (v) => values.push(v) });
		expect(values).toEqual([2, 4]);
	});

	it("filter should drop non-matching values", () => {
		const values: number[] = [];
		const source = createEventStream<number>((observer) => {
			observer.next?.(1);
			observer.next?.(2);
			observer.next?.(3);
			observer.complete?.();
		});
		const even = pipe(
			source,
			filter((x) => x % 2 === 0),
		);
		even.subscribe({ next: (v) => values.push(v) });
		expect(values).toEqual([2]);
	});

	it("takeUntil should complete when notifier emits", () => {
		const values: number[] = [];
		let completed = false;

		// Build the source stream with explicit control.
		let sourceObserver: { next?: (v: number) => void } | undefined;
		const source = createEventStream<number>((observer) => {
			sourceObserver = observer;
		});

		let notifierObserver: { next?: (v: void) => void } | undefined;
		const notifier = createEventStream<void>((observer) => {
			notifierObserver = observer;
		});

		const limited = pipe(source, takeUntil(notifier));
		limited.subscribe({
			next: (v) => values.push(v),
			complete: () => {
				completed = true;
			},
		});

		sourceObserver?.next?.(1);
		expect(values).toEqual([1]);

		notifierObserver?.next?.(undefined);
		expect(completed).toBe(true);

		// After notifier fired, source emissions are ignored.
		sourceObserver?.next?.(2);
		expect(values).toEqual([1]);
	});

	it("merge should combine multiple streams", () => {
		const values: string[] = [];
		const a = createEventStream<string>((observer) => {
			observer.next?.("a1");
			observer.complete?.();
		});
		const b = createEventStream<string>((observer) => {
			observer.next?.("b1");
			observer.complete?.();
		});
		const merged = merge(a, b);
		merged.subscribe({ next: (v) => values.push(v) });
		expect(values).toEqual(["a1", "b1"]);
	});
});
