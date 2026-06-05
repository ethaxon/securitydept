import { from, Observable, of } from "rxjs";
import { describe, expect, it } from "vitest";
import { createSignal } from "../../index";
import { RxEventStream, RxEventSubject } from "../index";

describe("@securitydept/client/rx", () => {
	it("toRxObservable(signal) emits immediately and tracks updates until unsubscribe", () => {
		const signal = createSignal("initial");
		const values: string[] = [];
		const subscription = from(signal).subscribe((value: string) => {
			values.push(value);
		});

		signal.set("next");
		subscription.unsubscribe();
		signal.set("ignored");

		expect(values).toEqual(["initial", "next"]);
	});

	it("toRxObservable(eventStream) preserves event-stream semantics", () => {
		const source = new RxEventSubject<number>();
		const values: number[] = [];

		source.subscribe((value: number) => values.push(value));
		source.next(1);
		source.next(2);

		expect(values).toEqual([1, 2]);
	});

	it("fromRxObservable wraps RxJS observables", () => {
		const values: number[] = [];

		RxEventStream.fromObservableInput(of(1, 2, 3)).subscribe({
			next: (value: number) => values.push(value),
		});

		expect(values).toEqual([1, 2, 3]);
	});

	it("fromRxObservable supports live observables", () => {
		const values: number[] = [];
		const stream = RxEventStream.fromObservableInput(
			new Observable<number>((subscriber) => {
				subscriber.next(7);
				return () => undefined;
			}),
		);

		stream.subscribe({ next: (value: number) => values.push(value) });

		expect(values).toEqual([7]);
	});
});
