import { type as defineType } from "arktype";
import { createEventSubject, type EventStreamTrait } from "../events";
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
	const subject = createEventSubject<TracingEvent>();
	const events: EventStreamTrait<TracingEvent> = subject;

	for (const subscriber of resolvedCreateOptions.subscribers) {
		events.subscribe({
			next(event) {
				subscriber.record(event);
			},
		});
	}

	return {
		record(event) {
			subject.next(event);
		},
		events,
	};
}
