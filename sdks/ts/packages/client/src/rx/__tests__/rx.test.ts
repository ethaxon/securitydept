import { Observable, of } from "rxjs";
import { describe, expect, it } from "vitest";
import {
	createAndThenComputedReplaySignal,
	createReplaySignal,
	createSignal,
	createSubject,
} from "../../index";
import { fromRxObservable, toRxObservable } from "../index";

describe("@securitydept/client/rx", () => {
	it("toRxObservable(signal) emits immediately and tracks updates until unsubscribe", () => {
		const signal = createSignal("initial");
		const values: string[] = [];
		const subscription = toRxObservable(signal).subscribe((value) => {
			values.push(value);
		});

		signal.set("next");
		subscription.unsubscribe();
		signal.set("ignored");

		expect(values).toEqual(["initial", "next"]);
	});

	it("toRxObservable(eventStream) preserves event-stream semantics", () => {
		const source = createSubject<number>();
		const values: number[] = [];

		toRxObservable(source).subscribe((value) => values.push(value));
		source.next(1);
		source.next(2);

		expect(values).toEqual([1, 2]);
	});

	it("toRxObservable(replaySignal) waits for the first emitted value", () => {
		const signal = createReplaySignal<string>();
		const values: string[] = [];
		const subscription = toRxObservable(signal).subscribe((value) => {
			values.push(value);
		});

		expect(values).toEqual([]);
		signal.emit("ready");
		subscription.unsubscribe();
		signal.emit("ignored");

		expect(values).toEqual(["ready"]);
	});

	it("toRxObservable(replaySignal) replays last emitted value to late subscribers", () => {
		const signal = createReplaySignal<string>();
		signal.emit("ready");
		const values: string[] = [];

		toRxObservable(signal).subscribe((value) => {
			values.push(value);
		});

		expect(values).toEqual(["ready"]);
	});

	it("toRxObservable(computedReplaySignal) waits for source replay values", () => {
		const source = createReplaySignal<number>();
		const doubled = createAndThenComputedReplaySignal(source, (value) => ({
			kind: "value",
			value: value * 2,
		}));
		const values: number[] = [];

		toRxObservable(doubled).subscribe((value) => {
			values.push(value);
		});
		source.emit(2);
		source.emit(4);

		expect(values).toEqual([4, 8]);
	});

	it("fromRxObservable wraps RxJS observables", () => {
		const values: number[] = [];

		fromRxObservable(of(1, 2, 3)).subscribe({
			next: (value) => values.push(value),
		});

		expect(values).toEqual([1, 2, 3]);
	});

	it("fromRxObservable supports live observables", () => {
		const values: number[] = [];
		const stream = fromRxObservable(
			new Observable<number>((subscriber) => {
				subscriber.next(7);
				return () => undefined;
			}),
		);

		stream.subscribe({ next: (value) => values.push(value) });

		expect(values).toEqual([7]);
	});
});
