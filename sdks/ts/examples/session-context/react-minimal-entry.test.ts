// @vitest-environment jsdom

import {
	createFoundationEnvironment,
	createInMemoryRecordStore,
	createRootSpan,
	createTracing,
	ResourceStatus,
} from "@securitydept/client";
import {
	SecuritydeptProvider,
	useResourceSnapshot,
} from "@securitydept/client-react";
import { provideSessionContext } from "@securitydept/session-context-client";
import { useSessionContextClient } from "@securitydept/session-context-client-react";
import { act, createElement, type ReactElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

function render(element: ReactElement) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);

	act(() => {
		root.render(element);
	});

	return {
		container,
		unmount() {
			act(() => {
				root.unmount();
			});
			container.remove();
		},
	};
}
describe("session-context react minimal entry", () => {
	afterEach(() => {
		document.body.innerHTML = "";
		delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
	});

	it("shows the standalone React entry path from provider wiring to principal consumption", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		const transport = {
			execute: vi.fn(async () => ({
				status: 200,
				headers: {},
				body: {
					subject: "session-user-1",
					display_name: "Alice",
				},
			})),
		};
		const environment = createFoundationEnvironment({
			transport: transport,
			sessionStorage: createInMemoryRecordStore(),
			span: createRootSpan(),
			tracing: createTracing(),
			providers: provideSessionContext({
				config: { baseUrl: "https://auth.example.com" },
			}),
		});

		function SessionBadge() {
			const sessionClient = useSessionContextClient();
			const sessionSnapshot = useResourceSnapshot(
				sessionClient.sessionResource,
			);
			if (
				sessionSnapshot.status === ResourceStatus.LoadingError ||
				sessionSnapshot.status === ResourceStatus.Error
			) {
				throw sessionSnapshot.error;
			}
			const session =
				sessionSnapshot.status === ResourceStatus.Reloading ||
				sessionSnapshot.status === ResourceStatus.Resolved
					? sessionSnapshot.value
					: null;

			useEffect(() => {
				void sessionClient.refresh();
			}, [sessionClient]);

			const principal = session?.principal ?? null;
			return createElement("output", null, principal?.displayName ?? "guest");
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ injector: environment.injector },
				createElement(SessionBadge),
			),
		);

		expect(view.container.textContent).toBe("guest");

		await act(async () => {
			await Promise.resolve();
		});

		expect(view.container.textContent).toBe("Alice");
		expect(transport.execute).toHaveBeenCalledWith(
			expect.objectContaining({
				method: "GET",
				url: "https://auth.example.com/auth/session/user-info",
			}),
		);

		view.unmount();
	});
});
