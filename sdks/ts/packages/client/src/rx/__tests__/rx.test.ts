import { BehaviorSubject, Observable, of, Subject } from "rxjs";
import { describe, expect, it } from "vitest";
import {
	ClientErrorKind,
	createAndThenComputedReplaySignal,
	createCancellationTokenSource,
	createEventSubject,
	createReplaySignal,
	createSignal,
	SYMBOL_OBSERVABLE,
} from "../../index";
import {
	behaviorSubjectToSignal,
	eventStreamToObservable,
	eventSubjectToSubject,
	observableToEventStream,
	observableToReplaySignal,
	signalToObservable,
	subjectToEventSubject,
} from "../index";

describe("@securitydept/client/rx", () => {
	it("toRxObservable(signal) emits immediately and tracks updates until unsubscribe", () => {
		const signal = createSignal("initial");
		const values: string[] = [];
		const subscription = signalToObservable(signal).subscribe(
			(value: string) => {
				values.push(value);
			},
		);

		signal.set("next");
		subscription.unsubscribe();
		signal.set("ignored");

		expect(values).toEqual(["initial", "next"]);
	});

	it("toRxObservable(eventStream) preserves event-stream semantics", () => {
		const source = createEventSubject<number>();
		const values: number[] = [];

		eventStreamToObservable(source).subscribe((value: number) =>
			values.push(value),
		);
		source.next(1);
		source.next(2);

		expect(values).toEqual([1, 2]);
	});

	it("toRxObservable(replaySignal) waits for the first emitted value", () => {
		const signal = createReplaySignal<string>();
		const values: string[] = [];
		const subscription = eventStreamToObservable(
			signal[SYMBOL_OBSERVABLE](),
		).subscribe((value: string) => {
			values.push(value);
		});

		expect(values).toEqual([]);
		signal.setValue("ready");
		subscription.unsubscribe();
		signal.setValue("ignored");

		expect(values).toEqual(["ready"]);
	});

	it("toRxObservable(replaySignal) replays last emitted value to late subscribers", () => {
		const signal = createReplaySignal<string>();
		signal.setValue("ready");
		const values: string[] = [];

		eventStreamToObservable(signal[SYMBOL_OBSERVABLE]()).subscribe(
			(value: string) => {
				values.push(value);
			},
		);

		expect(values).toEqual(["ready"]);
	});

	it("toRxObservable(computedReplaySignal) waits for source replay values", () => {
		const source = createReplaySignal<number>();
		const doubled = createAndThenComputedReplaySignal(source, (value) => ({
			kind: "value",
			value: value * 2,
		}));
		const values: number[] = [];

		eventStreamToObservable(doubled[SYMBOL_OBSERVABLE]()).subscribe(
			(value: number) => {
				values.push(value);
			},
		);
		source.setValue(2);
		source.setValue(4);

		expect(values).toEqual([4, 8]);
	});

	it("fromRxObservable wraps RxJS observables", () => {
		const values: number[] = [];

		observableToEventStream(of(1, 2, 3)).subscribe({
			next: (value: number) => values.push(value),
		});

		expect(values).toEqual([1, 2, 3]);
	});

	it("fromRxObservable supports live observables", () => {
		const values: number[] = [];
		const stream = observableToEventStream(
			new Observable<number>((subscriber) => {
				subscriber.next(7);
				return () => undefined;
			}),
		);

		stream.subscribe({ next: (value: number) => values.push(value) });

		expect(values).toEqual([7]);
	});

	it("behaviorSubjectToSignal exposes a behavior subject as a writable signal", () => {
		const subject = new BehaviorSubject("initial");
		const signal = behaviorSubjectToSignal(() => subject);
		const notifications: string[] = [];

		signal.subscribe(() => {
			notifications.push(signal.get());
		});
		signal.set("initial");
		subject.next("next");

		expect(signal.get()).toBe("next");
		expect(notifications).toEqual(["initial", "next"]);
	});

	it("observableToReplaySignal exposes replay signal semantics over values", async () => {
		const source = new Subject<string>();
		const signal = observableToReplaySignal(source);
		const values: string[] = [];

		eventStreamToObservable(signal[SYMBOL_OBSERVABLE]()).subscribe((value) => {
			values.push(value);
		});
		const pending = signal.whenValue();
		source.next("ready");

		await expect(pending).resolves.toBe("ready");
		expect(signal.get()).toEqual({ kind: "value", value: "ready" });
		expect(signal.hasValue()).toBe(true);
		expect(values).toEqual(["ready"]);
	});

	it("observableToReplaySignal supports cancellation while empty", async () => {
		const source = new Subject<string>();
		const signal = observableToReplaySignal(source);
		const cancellation = createCancellationTokenSource();
		const pending = signal.whenValue({ cancellationToken: cancellation.token });

		cancellation.cancel("stop");

		await expect(pending).rejects.toMatchObject({
			kind: ClientErrorKind.Cancelled,
		});
	});

	it("subjectToEventSubject exposes a RxJS subject as an event subject", () => {
		const source = new Subject<number>();
		const subject = subjectToEventSubject(source);
		const values: number[] = [];

		subject.subscribe({ next: (value) => values.push(value) });
		subject.next(1);
		source.next(2);

		expect(values).toEqual([1, 2]);
	});

	it("eventSubjectToSubject bridges an event subject to a RxJS subject", () => {
		const source = createEventSubject<number>();
		const subject = eventSubjectToSubject(source);
		const values: number[] = [];

		subject.subscribe((value) => values.push(value));
		subject.next(1);
		source.next(2);

		expect(values).toEqual([1, 2]);
	});
});
