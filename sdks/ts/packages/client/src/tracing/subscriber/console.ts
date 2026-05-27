import { type TracingSubscriberTrait } from "./types";

export function createConsoleTracingSubscriber(): TracingSubscriberTrait {
	return {
		record(event) {
			const label = `[${event.target}] ${event.name}`;
			switch (event.level) {
				case "debug":
					console.debug(label, event.fields ?? {});
					break;
				case "info":
					console.info(label, event.fields ?? {});
					break;
				case "warn":
					console.warn(label, event.fields ?? {});
					break;
				case "error":
					console.error(label, event.fields ?? {});
					break;
			}
		},
	};
}
