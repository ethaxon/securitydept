// @vitest-environment jsdom

import { createTraceTimelineStore } from "@securitydept/client";
import { act, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createTokenSetBackendHostTraceRecorder,
	TOKEN_SET_BACKEND_HOST_TRACE_SCOPE,
} from "../appTrace";
import { TraceTimelineSection } from "../TraceTimelineSection";

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
		const recordAppTrace = createTokenSetBackendHostTraceRecorder(timeline);
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(<TraceTimelineHarness timeline={timeline} />);
		});

		expect(container.textContent).toContain(
			"No backend-mode trace events recorded yet.",
		);

		await act(async () => {
			timeline.record({
				type: "token_set.callback.failed",
				at: Date.parse("2026-01-01T00:00:00Z"),
				scope: "token-set-context",
				source: "token_set_context_client",
				attributes: {
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
		expect(container.textContent).toContain(TOKEN_SET_BACKEND_HOST_TRACE_SCOPE);
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

		expect(container.textContent).toContain(
			"No backend-mode trace events recorded yet.",
		);
		expect(clearButton?.hasAttribute("disabled")).toBe(true);

		await act(async () => {
			root.unmount();
		});
		container.remove();
	});
});
