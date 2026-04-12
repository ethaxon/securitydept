// @vitest-environment jsdom

// Basic-auth React minimal entry — standalone adopter-facing evidence
//
// This test proves the standalone React entry path for basic-auth-context,
// exercising the canonical import surface from
// @securitydept/basic-auth-context-client/react.
//
// An adopter reading this file should understand "how do I wire up
// basic-auth zone awareness in React?" in one glance.

import type { BasicAuthContextProviderProps } from "@securitydept/basic-auth-context-client-react";
import {
	BasicAuthContextProvider,
	useBasicAuthContext,
} from "@securitydept/basic-auth-context-client-react";
import { act, createElement, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

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

function ProviderEntry(
	props: Omit<BasicAuthContextProviderProps, "children"> & {
		children?: ReactNode;
	},
) {
	return createElement(
		BasicAuthContextProvider,
		props as unknown as BasicAuthContextProviderProps,
	);
}

describe("basic-auth react minimal entry", () => {
	afterEach(() => {
		document.body.innerHTML = "";
		delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
	});

	it("shows the standalone React entry path: provider wiring → hook → zone-aware contract", () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;

		// 1. A consumer component that uses the React hook to access the
		//    zone-aware client and render a zone check result.
		function ZoneStatus() {
			const client = useBasicAuthContext();
			const zone = client.zoneForPath("/api/resource");
			return createElement(
				"output",
				null,
				zone ? `zone:${zone.zonePrefix}` : "no-zone",
			);
		}

		// 2. Wire up the provider with a minimal config.
		const view = render(
			createElement(
				ProviderEntry,
				{
					config: {
						baseUrl: "https://auth.example.com",
						zones: [{ zonePrefix: "/api" }],
					},
				} satisfies Omit<BasicAuthContextProviderProps, "children">,
				createElement(ZoneStatus),
			),
		);

		// 3. Verify the consumer can read zone-aware state via the hook.
		expect(view.container.textContent).toBe("zone:/api");

		view.unmount();
	});

	it("shows the handleUnauthorized contract usage from React context", () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;

		function AuthGuard() {
			const client = useBasicAuthContext();
			const result = client.handleUnauthorized("/api/data", 401);
			return createElement(
				"output",
				null,
				result.kind === "redirect" ? `redirect:${result.location}` : "ok",
			);
		}

		const view = render(
			createElement(
				ProviderEntry,
				{
					config: {
						baseUrl: "https://auth.example.com",
						zones: [{ zonePrefix: "/api" }],
					},
				} satisfies Omit<BasicAuthContextProviderProps, "children">,
				createElement(AuthGuard),
			),
		);

		// The 401 for /api/data should produce a redirect to the zone's login URL.
		expect(view.container.textContent).toContain("redirect:");
		expect(view.container.textContent).toContain(
			"https://auth.example.com/api/login",
		);

		view.unmount();
	});
});
