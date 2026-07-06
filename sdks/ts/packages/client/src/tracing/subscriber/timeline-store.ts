import { type EventStreamTrait } from "../../events";
import { RxEventSubject } from "../../rx/event";
import { type SpanNodeAttributes } from "../../span";
import { FixedCapacityRingBuffer } from "../../struct/ring-buffer";
import {
	TRACING_SPAN_ATTRIBUTE_PROVIDER_ID,
	type TracingEvent,
} from "../types";
import { type TracingSubscriberTrait } from "./types";

export interface TraceTimelineEntry extends Omit<TracingEvent, "span"> {
	id: number;
	recordedAtIso: string;
	span: {
		readonly id: string;
		readonly parentId?: string;
	};
	spanAttributes: readonly SpanNodeAttributes[];
}

/**
 * Bounded subscriber-side trace timeline.
 *
 * This store consumes tracing events through `record(event)` and keeps a
 * bounded local timeline for tests and UI surfaces. It is not the tracing
 * runtime itself.
 */
export class TraceTimelineStore implements TracingSubscriberTrait {
	protected nextId = 1;
	protected readonly timeline: FixedCapacityRingBuffer<TraceTimelineEntry>;
	protected readonly latestEntrySubject =
		new RxEventSubject<TraceTimelineEntry | null>();

	constructor(protected readonly limit = 200) {
		this.timeline = new FixedCapacityRingBuffer(limit);
	}

	get latestEntry(): EventStreamTrait<TraceTimelineEntry | null> {
		return this.latestEntrySubject;
	}

	get entries(): readonly TraceTimelineEntry[] {
		return this.timeline.toArray();
	}

	record(event: TracingEvent): void {
		const { span, ...eventWithoutSpan } = event;
		const entry: TraceTimelineEntry = {
			...eventWithoutSpan,
			id: this.nextId++,
			recordedAtIso: new Date(event.at).toISOString(),
			span: {
				id: span.id,
				...(span.parent ? { parentId: span.parent.id } : {}),
			},
			spanAttributes: span.getRootToNodeAttributes({
				providerId: TRACING_SPAN_ATTRIBUTE_PROVIDER_ID,
			}),
		};
		this.timeline.append(entry);
		this.latestEntrySubject.next(entry);
	}

	clear(): void {
		if (this.timeline.size > 0) {
			this.timeline.clear();
			this.latestEntrySubject.next(null);
		}
	}
}

export function createTraceTimelineStore(limit = 200): TraceTimelineStore {
	return new TraceTimelineStore(limit);
}
