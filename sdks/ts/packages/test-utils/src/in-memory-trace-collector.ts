import {
	OperationTraceEventType,
	type TracingEvent,
	type TracingSubscriberTrait,
} from "@securitydept/client";

const operationLifecycleTypes = new Set<string>([
	OperationTraceEventType.Started,
	OperationTraceEventType.Event,
	OperationTraceEventType.Error,
	OperationTraceEventType.Ended,
]);

/**
 * In-memory subscriber-side trace collector for testing.
 * Collects all trace events for assertion in tests.
 */
export class InMemoryTraceCollector implements TracingSubscriberTrait {
	private readonly _events: TracingEvent[] = [];

	record(event: TracingEvent): void {
		this._events.push(event);
	}

	/** All recorded trace events. */
	get events(): readonly TracingEvent[] {
		return this._events;
	}

	/** Filter events by type. */
	ofType(type: string): TracingEvent[] {
		return this._events.filter((event) => event.name === type);
	}

	/** Filter events by operation span id. */
	ofOperation(spanId: string): TracingEvent[] {
		return this._events.filter((event) => event.span.id === spanId);
	}

	/** Return only lifecycle events for one operation span id. */
	operationLifecycle(spanId: string): TracingEvent[] {
		return this.ofOperation(spanId).filter((event) =>
			operationLifecycleTypes.has(event.name),
		);
	}

	/** Assert the lifecycle sequence for one operation span id. */
	assertOperationLifecycle(
		spanId: string,
		expectedSequence: readonly string[],
	): TracingEvent[] {
		const lifecycle = this.operationLifecycle(spanId);
		const actualSequence = lifecycle.map((event) => event.name);

		if (
			actualSequence.length !== expectedSequence.length ||
			actualSequence.some((type, index) => type !== expectedSequence[index])
		) {
			throw new Error(
				`Operation lifecycle mismatch for ${spanId}: expected ${expectedSequence.join(" -> ")}, received ${actualSequence.join(" -> ")}`,
			);
		}

		return lifecycle;
	}

	/** Clear all recorded events. */
	clear(): void {
		this._events.length = 0;
	}
}
