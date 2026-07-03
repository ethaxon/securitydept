import { type as defineType } from "arktype";
import { SYMBOL_DISPOSE } from "../compat";
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
	let subscribers = resolvedCreateOptions.subscribers;

	return {
		record(event) {
			for (const subscriber of subscribers) {
				subscriber.record(event);
			}
			subject.next(event);
		},
		events: subject,
		dispose() {
			subscribers = [];
		},
		[SYMBOL_DISPOSE]() {
			this.dispose();
		},
	};
}
