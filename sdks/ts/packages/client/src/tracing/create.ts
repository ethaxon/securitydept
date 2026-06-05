import { type as defineType } from "arktype";
import { SYMBOL_DISPOSE } from "../compat";
import { type EventStreamTrait, type EventSubscriptionTrait } from "../events";
import { RxEventSubject } from "../rx/event";
import {
	type TraitInputValidator,
	throwValidationClientError,
	validateTraitInput,
	type WithTraitInputValidator,
} from "../validation";
import {
	type TracingSubscriberTrait,
	TracingSubscriberTraitSchema,
} from "./subscriber/types";
import { type TracingEvent, type TracingTrait } from "./types";

export interface TracingCreateOptions {
	subscribers?: readonly TracingSubscriberTrait[];
}

export const TracingCreateOptionsSchema = defineType({
	subscribers: TracingSubscriberTraitSchema.array(),
});

export function createTracing(
	options?: TracingCreateOptions & WithTraitInputValidator<TraitInputValidator>,
): TracingTrait {
	const { validators, ...resolvedOptions } = options ?? {};
	const resolvedCreateOptions = {
		subscribers: resolvedOptions.subscribers ?? [],
	};
	validateTraitInput({
		value: resolvedCreateOptions,
		bundledSchema: TracingCreateOptionsSchema,
		validator: validators,
		onInvalid: (failure) =>
			throwValidationClientError({
				code: "tracing.invalid_options",
				source: "tracing",
				messagePrefix: "createTracing could not validate tracingCreateOptions",
				failure,
			}),
	});
	const subject = new RxEventSubject<TracingEvent>();
	const events: EventStreamTrait<TracingEvent> = subject;
	const subscriptions: EventSubscriptionTrait[] = [];

	for (const subscriber of resolvedCreateOptions.subscribers) {
		subscriptions.push(
			events.subscribe({
				next(event) {
					subscriber.record(event);
				},
			}),
		);
	}

	return {
		record(event) {
			subject.next(event);
		},
		events,
		dispose() {
			for (const subscription of subscriptions.splice(0)) {
				subscription.unsubscribe();
			}
		},
		[SYMBOL_DISPOSE]() {
			this.dispose();
		},
	};
}
