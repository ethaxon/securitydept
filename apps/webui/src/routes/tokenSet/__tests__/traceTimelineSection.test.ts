import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTraceTimelineStore } from "@/lib/traceTimeline";
import { TraceTimelineSection } from "../TraceTimelineSection";

function renderTimeline(events = createTraceTimelineStore().get()): string {
	return renderToStaticMarkup(
		createElement(TraceTimelineSection, {
			events,
			onClear() {},
		}),
	);
}

describe("trace timeline section", () => {
	it("renders empty state and keeps clear disabled when no trace exists", () => {
		const markup = renderTimeline();

		expect(markup).toContain("No trace events recorded yet.");
		expect(markup).toContain("Clear Trace");
		expect(markup).toContain("disabled");
	});

	it("renders sdk and app traces with readable badges and survives clear", () => {
		const timeline = createTraceTimelineStore();

		timeline.record({
			type: "token_set.callback.started",
			at: Date.parse("2026-01-01T00:00:00Z"),
			scope: "token-set-context",
			source: "token_set_context_client",
			attributes: {
				stage: "callback",
			},
		});
		timeline.record({
			type: "token_set.app.entries.load.failed",
			at: Date.parse("2026-01-01T00:00:01Z"),
			scope: "apps.webui.token-set",
			source: "webui.token-set",
			attributes: {
				path: "/api/entries",
				code: "token_set.authorization.unavailable",
				recovery: "reauthenticate",
			},
		});
		timeline.record({
			type: "token_set.app.propagation_probe.cancel_requested",
			at: Date.parse("2026-01-01T00:00:02Z"),
			scope: "apps.webui.token-set",
			source: "webui.token-set",
			attributes: {
				path: "/api/propagation/api/health",
				reason: "superseded",
			},
		});

		const markup = renderTimeline(timeline.get());

		expect(markup).toContain("SDK Lifecycle");
		expect(markup).toContain("App Trace");
		expect(markup).toContain("Failed");
		expect(markup).toContain("Superseded");
		expect(markup).toContain("/api/entries");
		expect(markup).toContain("callback.started");
		expect(markup).not.toContain("No trace events recorded yet.");
		expect(markup).not.toContain('disabled=""');

		timeline.clear();

		const clearedMarkup = renderTimeline(timeline.get());
		expect(clearedMarkup).toContain("No trace events recorded yet.");
		expect(clearedMarkup).toContain('disabled=""');
	});
});
