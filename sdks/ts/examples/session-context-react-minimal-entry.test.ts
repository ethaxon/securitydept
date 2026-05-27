// @vitest-environment jsdom

import {
	createFoundationEnvironment,
	createInMemoryRecordStore,
	createRootSpan,
	createTracing,
} from "@securitydept/client";
import {
	SecuritydeptProvider,
	useReadableSignal,
	useSecuritydeptContext,
} from "@securitydept/client-react";
import {
	createSessionContextController,
	provideSessionContextController,
	SESSION_CONTEXT_CONTROLLER,
} from "@securitydept/session-context-client-react";
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
		const controller = createSessionContextController({
			config: { baseUrl: "https://auth.example.com" },
			environment: createFoundationEnvironment({
				transport: transport,
				sessionStorage: createInMemoryRecordStore(),
				span: createRootSpan(),
				tracing: createTracing(),
			}),
		});

		function SessionBadge() {
			const sessionController = useSecuritydeptContext().get(
				SESSION_CONTEXT_CONTROLLER,
			);
			const state = useReadableSignal(sessionController.state);

			useEffect(() => {
				void sessionController.refresh();
			}, [sessionController]);

			const principal = state.session?.principal ?? null;
			return createElement("output", null, principal?.displayName ?? "guest");
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ providers: provideSessionContextController(controller) },
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
