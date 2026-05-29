// @vitest-environment jsdom

import { AuthGuardResultKind } from "@securitydept/basic-auth-context-client";
import {
	BASIC_AUTH_CONTEXT_CLIENT,
	createBasicAuthContextClient,
	provideBasicAuthContextClient,
} from "@securitydept/basic-auth-context-client-react";
import { createFoundationEnvironment } from "@securitydept/client";
import {
	SecuritydeptProvider,
	useSecuritydeptContext,
} from "@securitydept/client-react";
import { act, createElement, type ReactElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

function render(element: ReactElement) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root: Root = createRoot(container);

	act(() => {
		root.render(element);
	});

	return {
		container,
		rerender(nextElement: ReactElement) {
			act(() => {
				root.render(nextElement);
			});
		},
		unmount() {
			act(() => {
				root.unmount();
			});
			container.remove();
		},
	};
}

describe("basic-auth react adapter", () => {
	const environment = createFoundationEnvironment({
		transport: {
			async execute() {
				throw new Error("Unexpected transport call.");
			},
		},
	});

	afterEach(() => {
		document.body.innerHTML = "";
		delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
	});

	it("provides a zone-aware client through SecuritydeptProvider and updates when client changes", () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		const observed: string[] = [];

		function Probe() {
			const injector = useSecuritydeptContext();
			const client = injector.get(BASIC_AUTH_CONTEXT_CLIENT);
			const zone = client.zoneForPath("/basic/api/groups");
			const redirect = client.handleUnauthorized("/basic/api/groups", 401);

			useEffect(() => {
				observed.push(
					[
						client.zones[0]?.zonePrefix ?? "missing",
						zone?.loginPath ?? "missing",
						redirect.kind,
					].join("|"),
				);
			}, [client, redirect.kind, zone?.loginPath]);

			return createElement(
				"output",
				null,
				[
					client.zones[0]?.zonePrefix ?? "missing",
					zone?.loginPath ?? "missing",
					redirect.kind,
				].join("|"),
			);
		}

		const initialClient = createBasicAuthContextClient({
			config: {
				baseUrl: "https://auth.example.com",
				zones: [{ zonePrefix: "/basic" }],
			},
			environment,
		});

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ providers: [provideBasicAuthContextClient(initialClient)] },
				createElement(Probe),
			),
		);

		expect(view.container.textContent).toBe("/basic|/basic/login|redirect");
		expect(observed).toEqual(["/basic|/basic/login|redirect"]);

		const updatedClient = createBasicAuthContextClient({
			config: {
				baseUrl: "https://auth.example.com",
				zones: [{ zonePrefix: "/internal/basic", loginSubpath: "/signin" }],
			},
			environment,
		});

		view.rerender(
			createElement(
				SecuritydeptProvider,
				{ providers: [provideBasicAuthContextClient(updatedClient)] },
				createElement(Probe),
			),
		);

		expect(view.container.textContent).toBe("/internal/basic|missing|ok");
		expect(observed).toEqual([
			"/basic|/basic/login|redirect",
			"/internal/basic|missing|ok",
		]);

		view.unmount();
	});

	it("keeps redirect results framework-neutral inside SecuritydeptProvider integration", () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;

		function Probe() {
			const injector = useSecuritydeptContext();
			const client = injector.get(BASIC_AUTH_CONTEXT_CLIENT);
			const result = client.handleUnauthorized("/basic/api/groups", 401);

			return createElement(
				"output",
				null,
				result.kind === AuthGuardResultKind.Redirect ? result.location : "ok",
			);
		}

		const client = createBasicAuthContextClient({
			config: {
				baseUrl: "https://auth.example.com",
				zones: [{ zonePrefix: "/basic" }],
			},
			environment,
		});

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ providers: [provideBasicAuthContextClient(client)] },
				createElement(Probe),
			),
		);

		expect(view.container.textContent).toBe(
			"https://auth.example.com/basic/login?post_auth_redirect_uri=%2Fbasic%2Fapi%2Fgroups",
		);

		view.unmount();
	});
});
