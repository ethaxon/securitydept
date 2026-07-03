import {
	TRACING_SPAN_ATTRIBUTE_PROVIDER_ID,
	type TracingEvent,
} from "../types";
import { type TracingSubscriberTrait } from "./types";

export class ConsoleTracingSubscriber implements TracingSubscriberTrait {
	record(event: TracingEvent): void {
		const label = `[${event.target}] ${event.name}`;
		const details = {
			...(event.fields ?? {}),
			spanAttributes: event.span.getRootToNodeAttributes({
				providerId: TRACING_SPAN_ATTRIBUTE_PROVIDER_ID,
			}),
		};
		switch (event.level) {
			case "debug":
				console.debug(label, details);
				break;
			case "info":
				console.info(label, details);
				break;
			case "warn":
				console.warn(label, details);
				break;
			case "error":
				console.error(label, details);
				break;
		}
	}
}

export function createConsoleTracingSubscriber(): ConsoleTracingSubscriber {
	return new ConsoleTracingSubscriber();
}
