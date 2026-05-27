// @vitest-environment jsdom

import {
	type BasicAuthContextClient,
	type BasicAuthContextClientConfig,
} from "@securitydept/basic-auth-context-client";
import {
	BASIC_AUTH_CONTEXT_CLIENT,
	createBasicAuthContextClient,
	provideBasicAuthContextClient,
} from "@securitydept/basic-auth-context-client-react";
import {
	SecuritydeptProvider,
	useSecuritydeptContext,
} from "@securitydept/client-react";
import { act, createElement, type ReactElement } from "react";
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

function createClient(
	config: BasicAuthContextClientConfig,
): BasicAuthContextClient {
	return createBasicAuthContextClient(config);
}

describe("basic-auth react minimal entry", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("shows the minimal injector path for consuming zone-aware basic-auth state in React", () => {
		function ZoneStatus() {
			const client = useSecuritydeptContext().get(BASIC_AUTH_CONTEXT_CLIENT);
			const zone = client.zoneForPath("/api/resource");
			return createElement(
				"output",
				null,
				zone ? `zone:${zone.zonePrefix}` : "no-zone",
			);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{
					providers: [
						provideBasicAuthContextClient(
							createClient({
								baseUrl: "https://auth.example.com",
								zones: [{ zonePrefix: "/api" }],
							}),
						),
					],
				},
				createElement(ZoneStatus),
			),
		);

		expect(view.container.textContent).toBe("zone:/api");
		view.unmount();
	});

	it("shows the handleUnauthorized contract through the injected client", () => {
		function AuthGuard() {
			const client = useSecuritydeptContext().get(BASIC_AUTH_CONTEXT_CLIENT);
			const result = client.handleUnauthorized("/api/data", 401);
			return createElement(
				"output",
				null,
				result.kind === "redirect" ? `redirect:${result.location}` : "ok",
			);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{
					providers: [
						provideBasicAuthContextClient(
							createClient({
								baseUrl: "https://auth.example.com",
								zones: [{ zonePrefix: "/api" }],
							}),
						),
					],
				},
				createElement(AuthGuard),
			),
		);

		expect(view.container.textContent).toContain("redirect:");
		expect(view.container.textContent).toContain(
			"https://auth.example.com/api/login",
		);
		view.unmount();
	});
});
