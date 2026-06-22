import {
	createRootSpan,
	createTraceTimelineStore,
	OperationTraceEventType,
	TracingLevel,
} from "@securitydept/client";
import {
	BackendOidcModeTraceEventType,
	BackendOidcModeTraceOperationName,
} from "@securitydept/token-set-context-client/backend-oidc-mode";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TOKEN_SET_BACKEND_MODE_CONFIG } from "@/auth/token-set/config";
import { TraceTimelineSection } from "@/routes/_playground/playground/token-set/-backend-mode/trace-timeline-section";

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

		expect(markup).toContain("No trace events yet.");
		expect(markup).toContain("Clear Trace");
		expect(markup).toContain("disabled");
	});

	it("renders sdk and app traces with readable badges and survives clear", () => {
		const timeline = createTraceTimelineStore();
		const rootSpan = createRootSpan({ idFactory: () => "root" });
		const operationSpan = rootSpan.fork({ idFactory: () => "op_backend_1" });
		const hostSpan = rootSpan.fork({ idFactory: () => "host_backend_1" });

		timeline.record({
			name: OperationTraceEventType.Started,
			at: Date.parse("2026-01-01T00:00:00Z") - 1,
			target: TOKEN_SET_BACKEND_MODE_CONFIG.tracing.clientTarget,
			span: operationSpan,
			level: TracingLevel.Info,
			fields: {
				operationName: BackendOidcModeTraceOperationName.Refresh,
			},
		});

		timeline.record({
			name: BackendOidcModeTraceEventType.UserInfoFallbackFailed,
			at: Date.parse("2026-01-01T00:00:00Z"),
			target: TOKEN_SET_BACKEND_MODE_CONFIG.tracing.clientTarget,
			span: operationSpan,
			level: TracingLevel.Warn,
			fields: {
				errorCode: "backend_oidc.user_info.invalid_response",
			},
		});
		timeline.record({
			name: "token_set.app.entries.load.failed",
			at: Date.parse("2026-01-01T00:00:01Z"),
			target: TOKEN_SET_BACKEND_MODE_CONFIG.tracing.hostTarget,
			span: hostSpan,
			level: TracingLevel.Error,
			fields: {
				path: "/api/entries",
				code: "token_set.authorization.unavailable",
				recovery: "reauthenticate",
			},
		});
		timeline.record({
			name: "token_set.app.propagation_probe.cancel_requested",
			at: Date.parse("2026-01-01T00:00:02Z"),
			target: TOKEN_SET_BACKEND_MODE_CONFIG.tracing.hostTarget,
			span: hostSpan,
			level: TracingLevel.Info,
			fields: {
				path: "/api/propagation/api/health",
				reason: "superseded",
			},
		});

		const markup = renderTimeline(timeline.get());

		expect(markup).toContain("Operation Lifecycle");
		expect(markup).toContain("SDK Lifecycle");
		expect(markup).toContain("App Trace");
		expect(markup).toContain("Trace timeline");
		expect(markup).toContain("operation: backend_oidc.refresh");
		expect(markup).toContain("Failed");
		expect(markup).toContain("Superseded");
		expect(markup).toContain("/api/entries");
		expect(markup).toContain("backend_oidc.user_info.fallback_failed");
		expect(markup).not.toContain("Operation:");
		expect(markup).not.toContain("<pre");
		expect(markup).not.toContain("No trace events yet.");
		expect(markup).not.toContain('disabled=""');

		timeline.clear();

		const clearedMarkup = renderTimeline(timeline.get());
		expect(clearedMarkup).toContain("No trace events yet.");
		expect(clearedMarkup).toContain('disabled=""');
	});
});
