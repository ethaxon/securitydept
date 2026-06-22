// @vitest-environment jsdom

import {
	createRootSpan,
	createTraceTimelineStore,
	OperationTraceEventType,
	TracingLevel,
} from "@securitydept/client";
import {
	FrontendOidcModeErrorCode,
	FrontendOidcModeTraceEventType,
	FrontendOidcModeTraceOperationName,
} from "@securitydept/token-set-context-client/frontend-oidc-mode";
import { act, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TraceTimelineSection } from "@/routes/_playground/playground/token-set/-frontend-mode/trace-timeline-section";

const TOKEN_SET_FRONTEND_TRACE_TARGET = "frontend-oidc-mode";

function TraceTimelineHarness(props: {
	timeline: ReturnType<typeof createTraceTimelineStore>;
}) {
	const events = useSyncExternalStore(
		(listener) => props.timeline.subscribe(listener),
		() => props.timeline.get(),
	);

	return (
		<TraceTimelineSection
			events={events}
			onClear={() => props.timeline.clear()}
		/>
	);
}

describe("frontend trace timeline harness", () => {
	beforeEach(() => {
		(
			globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
	});

	afterEach(() => {
		document.body.innerHTML = "";
		delete (
			globalThis as typeof globalThis & {
				IS_REACT_ACT_ENVIRONMENT?: boolean;
			}
		).IS_REACT_ACT_ENVIRONMENT;
	});

	it("wires sdk trace, frontend host trace, and clear interaction through the live store", async () => {
		const timeline = createTraceTimelineStore();
		const rootSpan = createRootSpan({ idFactory: () => "root" });
		const sdkSpan = rootSpan.fork({ idFactory: () => "sdk_frontend_1" });
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(<TraceTimelineHarness timeline={timeline} />);
		});

		expect(container.textContent).toContain("No trace events yet.");

		await act(async () => {
			timeline.record({
				name: OperationTraceEventType.Error,
				at: Date.parse("2026-01-01T00:00:00Z"),
				target: TOKEN_SET_FRONTEND_TRACE_TARGET,
				span: sdkSpan,
				level: TracingLevel.Error,
				fields: {
					operationName: FrontendOidcModeTraceOperationName.Callback,
					errorKind: "server",
					errorCode: FrontendOidcModeErrorCode.CallbackFailed,
					recovery: "retry",
				},
			});
			timeline.record({
				name: FrontendOidcModeTraceEventType.MetadataRefreshFailed,
				at: Date.parse("2026-01-01T00:00:01Z"),
				target: TOKEN_SET_FRONTEND_TRACE_TARGET,
				span: sdkSpan,
				level: TracingLevel.Error,
				fields: {
					errorCode: FrontendOidcModeErrorCode.AuthorizationServerUnavailable,
				},
			});
		});

		expect(container.textContent).toContain("SDK Lifecycle");
		expect(container.textContent).toContain(
			"operation: frontend_oidc.callback",
		);
		expect(container.textContent).toContain("metadata.refresh_failed");
		expect(container.textContent).toContain(
			`code: ${FrontendOidcModeErrorCode.CallbackFailed}`,
		);

		const clearButton = container.querySelector("button");
		expect(clearButton).not.toBeNull();

		await act(async () => {
			clearButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(container.textContent).toContain("No trace events yet.");
		expect(clearButton?.hasAttribute("disabled")).toBe(true);

		await act(async () => {
			root.unmount();
		});
		container.remove();
	});
});
