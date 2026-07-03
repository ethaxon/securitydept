// @vitest-environment jsdom

import {
	createRootSpan,
	createTraceTimelineStore,
	createTracing,
	TracingLevel,
} from "@securitydept/client";
import { useInteropObservable } from "@securitydept/client-react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTokenSetBackendHostTraceRecorder } from "@/routes/_playground/playground/token-set/-backend-mode/app-trace";
import { TraceTimelineSection } from "@/routes/_playground/playground/token-set/-backend-mode/trace-timeline-section";

function TraceTimelineHarness(props: {
	timeline: ReturnType<typeof createTraceTimelineStore>;
}) {
	useInteropObservable(props.timeline.latestEntry, { initialValue: null });
	const events = props.timeline.entries;

	return (
		<TraceTimelineSection
			events={events}
			onClear={() => props.timeline.clear()}
		/>
	);
}

describe("trace timeline harness", () => {
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

	it("wires sdk trace, app trace, and clear interaction through the live store", async () => {
		const timeline = createTraceTimelineStore();
		const tracing = createTracing({ subscribers: [timeline] });
		const rootSpan = createRootSpan({ idFactory: () => "root" });
		const sdkSpan = rootSpan.fork({ idFactory: () => "sdk_backend_1" });
		const hostSpan = rootSpan.fork({ idFactory: () => "host_backend_1" });
		const recordAppTrace = createTokenSetBackendHostTraceRecorder(
			tracing,
			hostSpan,
		);
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(<TraceTimelineHarness timeline={timeline} />);
		});

		expect(container.textContent).toContain("No trace events yet.");

		await act(async () => {
			tracing.record({
				name: "token_set.callback.failed",
				at: Date.parse("2026-01-01T00:00:00Z"),
				target: "token-set-context",
				span: sdkSpan,
				level: TracingLevel.Error,
				fields: {
					errorKind: "server",
					errorCode: "metadata_unavailable",
					recovery: "retry",
				},
			});
			recordAppTrace("token_set.app.entries.load.failed", {
				path: "/api/entries",
				code: "token_set.authorization.unavailable",
				recovery: "reauthenticate",
			});
			recordAppTrace("token_set.app.propagation_probe.cancel_requested", {
				path: "/api/propagation/api/health",
				reason: "superseded",
			});
		});

		expect(container.textContent).toContain("SDK Lifecycle");
		expect(container.textContent).toContain("App Trace");
		expect(container.textContent).toContain("callback.failed");
		expect(container.textContent).toContain("entries.load.failed");
		expect(container.textContent).toContain("code: metadata_unavailable");
		expect(container.textContent).toContain(
			"code: token_set.authorization.unavailable",
		);
		expect(container.textContent).toContain("Superseded");

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
