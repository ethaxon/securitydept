import { of } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import {
	concatMap,
	createEventStream,
	createReplaySubject,
	createSubject,
	debounceTime,
	exhaustMap,
	filter,
	fromRxObservable,
	map,
	merge,
	pipe,
	shareReplay,
	switchMap,
	takeUntil,
	toRxObservable,
	withLatestFromSignal,
} from "../../events/index";
import { createSignal } from "../../signals";

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

	it("switchMap should switch to the latest inner stream", () => {
		const source = createSubject<number>();
		const values: number[] = [];

		pipe(
			source,
			switchMap((value) =>
				createEventStream<number>((observer) => {
					observer.next?.(value * 10);
				}),
			),
		).subscribe({ next: (value) => values.push(value) });

		source.next(1);
		source.next(2);

		expect(values).toEqual([10, 20]);
	});

	it("concatMap should preserve inner stream order", () => {
		const values: number[] = [];
		const source = createEventStream<number>((observer) => {
			observer.next?.(1);
			observer.next?.(2);
			observer.complete?.();
		});

		pipe(
			source,
			concatMap((value) =>
				createEventStream<number>((observer) => {
					observer.next?.(value);
					observer.next?.(value * 10);
					observer.complete?.();
				}),
			),
		).subscribe({ next: (value) => values.push(value) });

		expect(values).toEqual([1, 10, 2, 20]);
	});

	it("exhaustMap should ignore new values while inner stream is active", () => {
		const source = createSubject<number>();
		const inner = createSubject<number>();
		const values: number[] = [];

		pipe(
			source,
			exhaustMap(() => inner),
		).subscribe({ next: (value) => values.push(value) });

		source.next(1);
		source.next(2);
		inner.next(10);
		inner.complete();
		source.next(3);

		expect(values).toEqual([10]);
	});

	it("debounceTime should use RxJS scheduling semantics", () => {
		vi.useFakeTimers();
		try {
			const source = createSubject<number>();
			const values: number[] = [];
			pipe(source, debounceTime(100)).subscribe({
				next: (value) => values.push(value),
			});

			source.next(1);
			source.next(2);
			vi.advanceTimersByTime(100);

			expect(values).toEqual([2]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("withLatestFromSignal should pair stream values with signal snapshots", () => {
		const signal = createSignal("initial");
		const source = createSubject<number>();
		const values: Array<[number, string]> = [];

		pipe(source, withLatestFromSignal(signal)).subscribe({
			next: (value) => values.push(value),
		});

		source.next(1);
		signal.set("updated");
		source.next(2);

		expect(values).toEqual([
			[1, "initial"],
			[2, "updated"],
		]);
	});
});

describe("subjects and RxJS interop", () => {
	it("createSubject should expose a hot event producer", () => {
		const subject = createSubject<number>();
		const values: number[] = [];

		subject.next(1);
		subject.subscribe({ next: (value) => values.push(value) });
		subject.next(2);

		expect(values).toEqual([2]);
	});

	it("createReplaySubject should replay recent values to late subscribers", () => {
		const subject = createReplaySubject<number>(2);
		const values: number[] = [];

		subject.next(1);
		subject.next(2);
		subject.next(3);
		subject.subscribe({ next: (value) => values.push(value) });

		expect(subject.bufferSize).toBe(2);
		expect(values).toEqual([2, 3]);
	});

	it("fromRxObservable should wrap RxJS observables", () => {
		const values: number[] = [];
		fromRxObservable(of(1, 2, 3)).subscribe({
			next: (value) => values.push(value),
		});

		expect(values).toEqual([1, 2, 3]);
	});

	it("toRxObservable should expose streams to RxJS operators", () => {
		const source = createSubject<number>();
		const values: number[] = [];
		toRxObservable(pipe(source, shareReplay(1))).subscribe((value) =>
			values.push(value),
		);

		source.next(42);

		expect(values).toEqual([42]);
	});
});
