import type { TraceEvent, TraceEventSinkTrait } from "@securitydept/client";

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

	/** Clear all recorded events. */
	clear(): void {
		this._events.length = 0;
	}
}
