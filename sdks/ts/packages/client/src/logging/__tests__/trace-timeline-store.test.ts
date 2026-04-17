import { describe, expect, it } from "vitest";
import { createTraceTimelineStore } from "../trace-timeline-store";

describe("trace timeline store", () => {
	it("records entries, notifies subscribers, and clears", () => {
		const timeline = createTraceTimelineStore();
		const notifications: number[] = [];
		const unsubscribe = timeline.subscribe(() => {
			notifications.push(timeline.get().length);
		});

		timeline.record({
			type: "frontend_oidc.callback.started",
			at: Date.parse("2026-01-01T00:00:00Z"),
			scope: "frontend-oidc-mode",
			source: "client",
		});

		expect(timeline.get()).toHaveLength(1);
		expect(timeline.get()[0]).toMatchObject({
			id: 1,
			recordedAtIso: "2026-01-01T00:00:00.000Z",
			type: "frontend_oidc.callback.started",
		});
		expect(notifications).toEqual([1]);

		timeline.clear();
		expect(timeline.get()).toHaveLength(0);
		expect(notifications).toEqual([1, 0]);

		unsubscribe();
	});

	it("keeps only the newest entries within the configured limit", () => {
		const timeline = createTraceTimelineStore(2);

		timeline.record({
			type: "event.1",
			at: Date.parse("2026-01-01T00:00:00Z"),
		});
		timeline.record({
			type: "event.2",
			at: Date.parse("2026-01-01T00:00:01Z"),
		});
		timeline.record({
			type: "event.3",
			at: Date.parse("2026-01-01T00:00:02Z"),
		});

		expect(timeline.get().map((entry) => entry.type)).toEqual([
			"event.2",
			"event.3",
		]);
	});

	it("marks invalid timestamps without throwing", () => {
		const timeline = createTraceTimelineStore();

		timeline.record({
			type: "event.invalid",
			at: Number.NaN,
		});

		expect(timeline.get()[0]?.recordedAtIso).toBe("invalid-timestamp");
	});
});
