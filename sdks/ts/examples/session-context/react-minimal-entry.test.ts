// @vitest-environment jsdom

import { createInMemoryRecordStore } from "@securitydept/client";
import {
	createEnvironmentForReact,
	SecuritydeptProvider,
	useSuspenseResourceValue,
} from "@securitydept/client-react";
import {
	provideSessionContext,
	SESSION_CONTEXT_CLIENT,
} from "@securitydept/session-context-client";
import { useSessionContextClient } from "@securitydept/session-context-client-react";
import { act, createElement, type ReactElement, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

function render(element: ReactElement) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);

	act(() => root.render(element));

	return {
		container,
		unmount() {
			act(() => root.unmount());
			container.remove();
		},
	};
}

describe("session-context React minimal entry", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("composes the React environment and reads session state through Suspense", async () => {
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
		const environment = createEnvironmentForReact({
			transport,
			sessionStorage: createInMemoryRecordStore(),
			providers: provideSessionContext({
				config: {
					baseUrl: "https://auth.example.com",
					autoStart: true,
				},
			}),
		});

		function SessionBadge() {
			const client = useSessionContextClient();
			const session = useSuspenseResourceValue(client.sessionResource);
			return createElement(
				"output",
				null,
				session?.principal.displayName ?? "guest",
			);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ injector: environment.injector },
				createElement(
					Suspense,
					{ fallback: createElement("output", null, "loading") },
					createElement(SessionBadge),
				),
			),
		);

		expect(view.container.textContent).toBe("loading");

		await act(async () => {
			await environment.injector
				.get(SESSION_CONTEXT_CLIENT)
				.sessionResource.whenValue();
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
