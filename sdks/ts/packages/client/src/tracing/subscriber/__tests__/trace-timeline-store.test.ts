import { describe, expect, it } from "vitest";
import {
	createRootSpan,
	OperationTraceEventType,
	TRACING_SPAN_ATTRIBUTE_PROVIDER_ID,
	TracingLevel,
} from "../../../index";
import {
	createTraceTimelineStore,
	type TraceTimelineEntry,
} from "../timeline-store";

describe("trace timeline store", () => {
	it("requires a positive integer limit", () => {
		expect(() => createTraceTimelineStore(0)).toThrow(RangeError);
		expect(() => createTraceTimelineStore(1.5)).toThrow(RangeError);
	});

	it("records entries, notifies subscribers, and clears", () => {
		const timeline = createTraceTimelineStore();
		const notifications: number[] = [];
		const publishedEntries: Array<TraceTimelineEntry | null> = [];
		const span = createRootSpan({ idFactory: () => "trace_root" });
		const subscription = timeline.latestEntry.subscribe({
			next: (entry) => {
				publishedEntries.push(entry);
				notifications.push(timeline.entries.length);
			},
		});

		timeline.record({
			name: OperationTraceEventType.Started,
			at: Date.parse("2026-01-01T00:00:00Z"),
			target: "frontend-oidc-mode",
			span,
			level: TracingLevel.Info,
			fields: {
				"operation.name": "frontend_oidc.callback",
			},
		});

		expect(timeline.entries).toHaveLength(1);
		expect(timeline.entries[0]).toMatchObject({
			id: 1,
			recordedAtIso: "2026-01-01T00:00:00.000Z",
			name: OperationTraceEventType.Started,
			target: "frontend-oidc-mode",
			span: expect.objectContaining({
				id: "trace_root",
			}),
		});
		expect(publishedEntries[0]).toBe(timeline.entries[0]);
		expect(notifications).toEqual([1]);

		timeline.clear();
		expect(timeline.entries).toHaveLength(0);
		expect(publishedEntries).toEqual([expect.any(Object), null]);
		expect(notifications).toEqual([1, 0]);

		subscription.unsubscribe();
	});

	it("captures provider attributes and releases the live span", () => {
		const timeline = createTraceTimelineStore();
		const span = createRootSpan({ idFactory: () => "trace_root" }).fork({
			mutable: true,
			idFactory: () => "trace_operation",
			attributes: { operation: "refresh" },
		});
		span.setAttributes(
			{ phase: "started" },
			{ providerId: TRACING_SPAN_ATTRIBUTE_PROVIDER_ID },
		);

		timeline.record({
			name: OperationTraceEventType.Started,
			at: 1,
			target: "test",
			span,
			level: TracingLevel.Info,
		});
		span.setAttributes(
			{ phase: "ended" },
			{ providerId: TRACING_SPAN_ATTRIBUTE_PROVIDER_ID },
		);

		expect(timeline.entries[0]?.spanAttributes.at(-1)?.attributes).toEqual({
			operation: "refresh",
			phase: "started",
		});
		expect("fork" in (timeline.entries[0]?.span ?? {})).toBe(false);
	});

	it("keeps only the newest entries within the configured limit", () => {
		const timeline = createTraceTimelineStore(2);
		const span = createRootSpan({ idFactory: () => "trace_root" });

		timeline.record({
			name: "event.1",
			at: Date.parse("2026-01-01T00:00:00Z"),
			target: "trace-test",
			span,
			level: TracingLevel.Info,
		});
		timeline.record({
			name: "event.2",
			at: Date.parse("2026-01-01T00:00:01Z"),
			target: "trace-test",
			span,
			level: TracingLevel.Info,
		});
		timeline.record({
			name: "event.3",
			at: Date.parse("2026-01-01T00:00:02Z"),
			target: "trace-test",
			span,
			level: TracingLevel.Info,
		});

		expect(timeline.entries.map((entry) => entry.name)).toEqual([
			"event.2",
			"event.3",
		]);
	});
});
