// @vitest-environment jsdom

import {
	SessionContextProvider,
	type SessionContextProviderProps,
	useSessionPrincipal,
} from "@securitydept/session-context-client-react";
import { act, createElement, type ReactElement, type ReactNode } from "react";
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

function SessionProviderEntry(
	props: Omit<SessionContextProviderProps, "children"> & {
		children?: ReactNode;
	},
) {
	return createElement(
		SessionContextProvider,
		props as unknown as SessionContextProviderProps,
	);
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
					principal: {
						subject: "session-user-1",
						displayName: "Alice",
					},
				},
			})),
		};

		function SessionBadge() {
			const principal = useSessionPrincipal();
			return createElement("output", null, principal?.displayName ?? "guest");
		}

		const providerProps = {
			config: { baseUrl: "https://auth.example.com" },
			transport,
		} satisfies Omit<SessionContextProviderProps, "children">;

		const view = render(
			createElement(
				SessionProviderEntry,
				providerProps,
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
