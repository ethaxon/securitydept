import {
	createTraceTimelineStore,
	OperationTraceEventType,
} from "@securitydept/client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	FrontendHostTraceEventType,
	TOKEN_SET_FRONTEND_HOST_TRACE_SCOPE,
	TOKEN_SET_FRONTEND_HOST_TRACE_SOURCE,
} from "@/lib/tokenSetFrontendModeClient";
import { TraceTimelineSection } from "../TraceTimelineSection";

function renderTimeline(events = createTraceTimelineStore().get()): string {
	return renderToStaticMarkup(
		createElement(TraceTimelineSection, {
			events,
			onClear() {},
		}),
	);
}

describe("frontend trace timeline section", () => {
	it("renders empty state and keeps clear disabled when no trace exists", () => {
		const markup = renderTimeline();

		expect(markup).toContain("No frontend-mode trace events recorded yet.");
		expect(markup).toContain("Clear Trace");
		expect(markup).toContain("disabled");
	});

	it("renders sdk and frontend host trace events in one structured timeline", () => {
		const timeline = createTraceTimelineStore();

		timeline.record({
			type: OperationTraceEventType.Started,
			at: Date.parse("2026-01-01T00:00:00Z") - 1,
			scope: "frontend-oidc-mode",
			source: "frontend_oidc_mode_client",
			operationId: "op_frontend_1",
			attributes: {
				operationName: "frontend_oidc.callback",
			},
		});

		timeline.record({
			type: "token_set.popup.closed_by_user",
			at: Date.parse("2026-01-01T00:00:00Z"),
			scope: "token-set-context",
			source: "token_set_context_client",
			operationId: "op_frontend_1",
			attributes: {
				recovery: "restart_flow",
			},
		});
		timeline.record({
			type: FrontendHostTraceEventType.CrossTabHydrated,
			at: Date.parse("2026-01-01T00:00:01Z"),
			scope: TOKEN_SET_FRONTEND_HOST_TRACE_SCOPE,
			source: TOKEN_SET_FRONTEND_HOST_TRACE_SOURCE,
			attributes: {
				hasAccessToken: true,
				syncCount: 3,
			},
		});

		const markup = renderTimeline(timeline.get());

		expect(markup).toContain("Structured Trace Timeline");
		expect(markup).toContain("Operation Lifecycle");
		expect(markup).toContain("SDK Lifecycle");
		expect(markup).toContain("Host Adoption");
		expect(markup).toContain("Operation: op_frontend_1");
		expect(markup).toContain("operation: frontend_oidc.callback");
		expect(markup).toContain(TOKEN_SET_FRONTEND_HOST_TRACE_SCOPE);
		expect(markup).toContain("popup.closed_by_user");
		expect(markup).toContain("cross_tab.hydrated");
		expect(markup).toContain("syncCount");
		expect(markup).not.toContain("No frontend-mode trace events recorded yet.");
		expect(markup).not.toContain('disabled=""');
	});
});
