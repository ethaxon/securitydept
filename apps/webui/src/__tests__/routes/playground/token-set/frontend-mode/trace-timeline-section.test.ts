import {
	createRootSpan,
	createTraceTimelineStore,
	OperationTraceEventType,
	TracingLevel,
} from "@securitydept/client";
import {
	FrontendOidcModeOperationEventName,
	FrontendOidcModeTraceEventType,
	FrontendOidcModeTraceOperationName,
} from "@securitydept/token-set-context-client/frontend-oidc-mode";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TOKEN_SET_FRONTEND_MODE_CONFIG } from "@/auth/token-set/config";
import { TraceTimelineSection } from "@/routes/_playground/playground/token-set/-frontend-mode/trace-timeline-section";

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

		expect(markup).toContain("No trace events yet.");
		expect(markup).toContain("Clear Trace");
		expect(markup).toContain("disabled");
	});

	it("renders sdk and frontend host trace events in one structured timeline", () => {
		const timeline = createTraceTimelineStore();
		const rootSpan = createRootSpan({ idFactory: () => "root" });
		const operationSpan = rootSpan.fork({ idFactory: () => "op_frontend_1" });

		timeline.record({
			name: OperationTraceEventType.Started,
			at: Date.parse("2026-01-01T00:00:00Z") - 1,
			target: TOKEN_SET_FRONTEND_MODE_CONFIG.tracing.clientTarget,
			span: operationSpan,
			level: TracingLevel.Info,
			fields: {
				operationName: FrontendOidcModeTraceOperationName.Callback,
			},
		});

		timeline.record({
			name: OperationTraceEventType.Event,
			at: Date.parse("2026-01-01T00:00:00Z"),
			target: TOKEN_SET_FRONTEND_MODE_CONFIG.tracing.clientTarget,
			span: operationSpan,
			level: TracingLevel.Info,
			fields: {
				operationName: FrontendOidcModeTraceOperationName.LoginPopup,
				eventName: FrontendOidcModeOperationEventName.PopupOpened,
				popupCallbackUrl: "https://app.example.com/popup-callback",
			},
		});
		timeline.record({
			name: FrontendOidcModeTraceEventType.MetadataRefreshed,
			at: Date.parse("2026-01-01T00:00:01Z"),
			target: TOKEN_SET_FRONTEND_MODE_CONFIG.tracing.clientTarget,
			span: operationSpan,
			level: TracingLevel.Info,
			fields: {
				configuredIssuer: "https://idp.example.com",
				resolvedIssuer: "https://idp.example.com",
			},
		});

		const markup = renderTimeline(timeline.get());

		expect(markup).toContain("Trace timeline");
		expect(markup).toContain("Operation Lifecycle");
		expect(markup).toContain("SDK Lifecycle");
		expect(markup).toContain("operation: frontend_oidc.callback");
		expect(markup).toContain("event: popup.opened");
		expect(markup).toContain("metadata.refreshed");
		expect(markup).toContain("https://idp.example.com");
		expect(markup).not.toContain("Operation:");
		expect(markup).not.toContain("<pre");
		expect(markup).not.toContain("No trace events yet.");
		expect(markup).not.toContain('disabled=""');
	});
});
