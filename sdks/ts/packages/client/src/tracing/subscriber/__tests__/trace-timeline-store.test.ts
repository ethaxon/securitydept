import { describe, expect, it } from "vitest";
import {
	createRootSpan,
	OperationTraceEventType,
	TracingLevel,
} from "../../../index";
import { createTraceTimelineStore } from "../timeline-store";

describe("trace timeline store", () => {
	it("records entries, notifies subscribers, and clears", () => {
		const timeline = createTraceTimelineStore();
		const notifications: number[] = [];
		const span = createRootSpan({ idFactory: () => "trace_root" });
		const unsubscribe = timeline.subscribe(() => {
			notifications.push(timeline.get().length);
		});

		timeline.record({
			name: OperationTraceEventType.Started,
			at: Date.parse("2026-01-01T00:00:00Z"),
			target: "frontend-oidc-mode",
			span,
			level: TracingLevel.Info,
			fields: {
				operationName: "frontend_oidc.callback",
			},
		});

		expect(timeline.get()).toHaveLength(1);
		expect(timeline.get()[0]).toMatchObject({
			id: 1,
			recordedAtIso: "2026-01-01T00:00:00.000Z",
			name: OperationTraceEventType.Started,
			target: "frontend-oidc-mode",
			span: expect.objectContaining({
				id: "trace_root",
			}),
		});
		expect(notifications).toEqual([1]);

		timeline.clear();
		expect(timeline.get()).toHaveLength(0);
		expect(notifications).toEqual([1, 0]);

		unsubscribe();
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

		expect(timeline.get().map((entry) => entry.name)).toEqual([
			"event.2",
			"event.3",
		]);
	});

	it("marks invalid timestamps without throwing", () => {
		const timeline = createTraceTimelineStore();
		const span = createRootSpan({ idFactory: () => "trace_root" });

		timeline.record({
			name: "event.invalid",
			at: Number.NaN,
			target: "trace-test",
			span,
			level: TracingLevel.Info,
		});

		expect(timeline.get()[0]?.recordedAtIso).toBe("invalid-timestamp");
	});
});
