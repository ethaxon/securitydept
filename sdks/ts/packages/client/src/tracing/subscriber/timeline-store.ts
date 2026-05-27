import { type TracingEvent } from "../types";
import { type TracingSubscriberTrait } from "./types";

export interface TraceTimelineEntry extends TracingEvent {
	id: number;
	recordedAtIso: string;
}

export interface TraceTimelineStore extends TracingSubscriberTrait {
	get(): readonly TraceTimelineEntry[];
	subscribe(listener: () => void): () => void;
	clear(): void;
}

/**
 * Create a subscriber-side trace timeline store.
 *
 * This store consumes tracing events through `record(event)` and keeps a
 * bounded local timeline for tests and UI surfaces. It is not the tracing
 * runtime itself.
 */
export function createTraceTimelineStore(limit = 200): TraceTimelineStore {
	let nextId = 1;
	let entries: TraceTimelineEntry[] = [];
	const listeners = new Set<() => void>();

	function readRecordedAtIso(at: number): string {
		if (!Number.isFinite(at)) {
			return "invalid-timestamp";
		}

		const date = new Date(at);
		const timestamp = date.getTime();
		if (!Number.isFinite(timestamp)) {
			return "invalid-timestamp";
		}

		return date.toISOString();
	}

	function notify() {
		for (const listener of listeners) {
			listener();
		}
	}

	return {
		record(event) {
			const entry: TraceTimelineEntry = {
				...event,
				id: nextId++,
				recordedAtIso: readRecordedAtIso(event.at),
			};
			entries = [...entries, entry].slice(-limit);
			notify();
		},
		get() {
			return entries;
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		clear() {
			if (entries.length === 0) {
				return;
			}
			entries = [];
			notify();
		},
	};
}
