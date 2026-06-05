import { BehaviorSubject } from "rxjs";
import { type SubscribableTrait, type SubscriptionTrait } from "../compat";

export interface ToBehviorSubjectWithInitialValueOptions<T> {
	initialValue: T;
	requireSync?: false | null;
}

export interface ToBehviorSubjectWithRequireSyncOptions {
	requireSync: true;
}

export type ToBehaviorSubjectOptions<T> =
	| ToBehviorSubjectWithInitialValueOptions<T>
	| ToBehviorSubjectWithRequireSyncOptions;

export function subscribableToBehaviorSubject<T>(
	subscribable: SubscribableTrait<T>,
	options: ToBehaviorSubjectOptions<T>,
): BehaviorSubject<T> {
	let subject: BehaviorSubject<T> | undefined;
	let subscription: SubscriptionTrait | undefined;
	if (options.requireSync) {
		subscription = subscribable.subscribe({
			next(value) {
				if (!subject) {
					subject = new BehaviorSubject(value);
				} else {
					subject.next(value);
				}
			},
			error(error) {
				if (!subject) {
					throw error;
				}
				subject.error(error);
			},
			complete() {
				subject?.complete();
			},
		});
		if (!subject) {
			subscription.unsubscribe();
			throw new Error(
				"The subscribable did not emit any value synchronously, but requireSync was set to true.",
			);
		}
	} else {
		subject = new BehaviorSubject<T>(options.initialValue);
		subscription = subscribable.subscribe({
			next: (value) => {
				// biome-ignore lint/style/noNonNullAssertion: false positive, subject is always defined here
				subject!.next(value);
			},
			error: (error) => {
				// biome-ignore lint/style/noNonNullAssertion: false positive, subject is always defined here
				subject!.error(error);
			},
			complete: () => {
				// biome-ignore lint/style/noNonNullAssertion: false positive, subject is always defined here
				subject!.complete();
			},
		});
	}
	const originalUnsubscribe = subject.unsubscribe.bind(subject);
	subject.unsubscribe = () => {
		subscription.unsubscribe();
		originalUnsubscribe();
	};

	return subject;
}
