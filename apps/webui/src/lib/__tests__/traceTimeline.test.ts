import { describe, expect, it } from "vitest";
import { createTraceTimelineStore } from "../traceTimeline";

describe("trace timeline store", () => {
	it("records entries, notifies subscribers, and clears", () => {
		const timeline = createTraceTimelineStore();
		let notifications = 0;
		const unsubscribe = timeline.subscribe(() => {
			notifications += 1;
		});

		timeline.record({
			type: "token_set.callback.started",
			at: Date.parse("2026-01-01T00:00:00Z"),
			scope: "token-set-context",
			attributes: {
				stage: "callback",
			},
		});

		expect(notifications).toBe(1);
		expect(timeline.get()).toHaveLength(1);
		expect(timeline.get()[0]).toMatchObject({
			id: 1,
			type: "token_set.callback.started",
			recordedAtIso: "2026-01-01T00:00:00.000Z",
		});

		timeline.clear();
		expect(notifications).toBe(2);
		expect(timeline.get()).toHaveLength(0);

		unsubscribe();
	});

	it("keeps only the configured number of most recent entries", () => {
		const timeline = createTraceTimelineStore(2);

		timeline.record({
			type: "trace.one",
			at: 1,
		});
		timeline.record({
			type: "trace.two",
			at: 2,
		});
		timeline.record({
			type: "trace.three",
			at: 3,
		});

		expect(timeline.get().map((entry) => entry.type)).toEqual([
			"trace.two",
			"trace.three",
		]);
	});

	it("downgrades invalid timestamps instead of throwing", () => {
		const timeline = createTraceTimelineStore();

		expect(() => {
			timeline.record({
				type: "trace.invalid",
				at: Number.NaN,
			});
		}).not.toThrow();

		expect(timeline.get()).toHaveLength(1);
		expect(timeline.get()[0]).toMatchObject({
			type: "trace.invalid",
			recordedAtIso: "invalid-timestamp",
		});
	});
});
