import {
	OperationTraceEventType,
	type TraceEvent,
	type TraceEventSinkTrait,
} from "@securitydept/client";

const operationLifecycleTypes = new Set<string>([
	OperationTraceEventType.Started,
	OperationTraceEventType.Event,
	OperationTraceEventType.Error,
	OperationTraceEventType.Ended,
]);

/**
 * In-memory trace collector for testing.
 * Collects all trace events for assertion in tests.
 */
export class InMemoryTraceCollector implements TraceEventSinkTrait {
	private readonly _events: TraceEvent[] = [];

	record(event: TraceEvent): void {
		this._events.push(event);
	}

	/** All recorded trace events. */
	get events(): readonly TraceEvent[] {
		return this._events;
	}

	/** Filter events by type. */
	ofType(type: string): TraceEvent[] {
		return this._events.filter((e) => e.type === type);
	}

	/** Filter events by operation id. */
	ofOperation(operationId: string): TraceEvent[] {
		return this._events.filter((event) => event.operationId === operationId);
	}

	/** Return only lifecycle events for one operation id. */
	operationLifecycle(operationId: string): TraceEvent[] {
		return this.ofOperation(operationId).filter((event) =>
			operationLifecycleTypes.has(event.type),
		);
	}

	/** Assert the lifecycle sequence for one operation id. */
	assertOperationLifecycle(
		operationId: string,
		expectedSequence: readonly string[],
	): TraceEvent[] {
		const lifecycle = this.operationLifecycle(operationId);
		const actualSequence = lifecycle.map((event) => event.type);

		if (
			actualSequence.length !== expectedSequence.length ||
			actualSequence.some((type, index) => type !== expectedSequence[index])
		) {
			throw new Error(
				`Operation lifecycle mismatch for ${operationId}: expected ${expectedSequence.join(" -> ")}, received ${actualSequence.join(" -> ")}`,
			);
		}

		return lifecycle;
	}

	/** Clear all recorded events. */
	clear(): void {
		this._events.length = 0;
	}
}
