import { SYMBOL_OBSERVABLE } from "../compat/observable";
import {
	type EventObserverTrait,
	type EventSubjectTrait,
	type EventSubscriptionTrait,
} from "../events/types";
import { type PageLifecycleTrait } from "../page";

export interface TestEventSubjectTrait<T> extends EventSubjectTrait<T> {
	get observerCount(): number;
}

export interface TestPageLifecycleTrait<TResumeEvent = unknown>
	extends PageLifecycleTrait<TResumeEvent> {
	readonly resume: TestEventSubjectTrait<TResumeEvent>;
}

export function createPageLifecycleForTest<
	TResumeEvent = unknown,
>(): TestPageLifecycleTrait<TResumeEvent> {
	return {
		resume: createEventSubjectForTest<TResumeEvent>(),
	};
}

export function createEventSubjectForTest<T>(): TestEventSubjectTrait<T> {
	const observers = new Set<Partial<EventObserverTrait<T>>>();
	const stream = {
		subscribe(observer) {
			observers.add(observer);
			return {
				unsubscribe() {
					observers.delete(observer);
				},
			} satisfies EventSubscriptionTrait;
		},
		next(value) {
			for (const observer of [...observers]) {
				observer.next?.(value);
			}
		},
		error(error) {
			for (const observer of [...observers]) {
				observer.error?.(error);
			}
		},
		complete() {
			for (const observer of [...observers]) {
				observer.complete?.();
			}
			observers.clear();
		},
		get observerCount() {
			return observers.size;
		},
		[SYMBOL_OBSERVABLE]() {
			return this;
		},
	} satisfies TestEventSubjectTrait<T>;
	return stream;
}
