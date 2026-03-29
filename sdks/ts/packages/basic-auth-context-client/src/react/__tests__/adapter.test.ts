// @vitest-environment jsdom

import { act, createElement, type ReactElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AuthGuardResultKind } from "../../types";
import {
	BasicAuthContextProvider,
	type BasicAuthContextProviderProps,
	useBasicAuthContext,
} from "../index";

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
	afterEach(() => {
		document.body.innerHTML = "";
		delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
	});

	it("provides a zone-aware client through context and updates when config changes", () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		const observed: string[] = [];

		function Probe() {
			const client = useBasicAuthContext();
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

		const providerProps = {
			config: {
				baseUrl: "https://auth.example.com",
				zones: [{ zonePrefix: "/basic" }],
			},
		} satisfies Omit<BasicAuthContextProviderProps, "children">;

		const view = render(
			createElement(
				BasicAuthContextProvider,
				providerProps as BasicAuthContextProviderProps,
				createElement(Probe),
			),
		);

		expect(view.container.textContent).toBe("/basic|/basic/login|redirect");
		expect(observed).toEqual(["/basic|/basic/login|redirect"]);

		const updatedProviderProps = {
			config: {
				baseUrl: "https://auth.example.com",
				zones: [{ zonePrefix: "/internal/basic", loginSubpath: "/signin" }],
			},
		} satisfies Omit<BasicAuthContextProviderProps, "children">;

		view.rerender(
			createElement(
				BasicAuthContextProvider,
				updatedProviderProps as BasicAuthContextProviderProps,
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

	it("throws when the hook is used outside its provider", () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;

		function BrokenProbe() {
			const client = useBasicAuthContext();
			return createElement("output", null, client.zones.length);
		}

		expect(() => render(createElement(BrokenProbe))).toThrow(
			"useBasicAuthContext must be used inside <BasicAuthContextProvider>",
		);
	});

	it("keeps redirect results framework-neutral inside React integration", () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;

		function Probe() {
			const client = useBasicAuthContext();
			const result = client.handleUnauthorized("/basic/api/groups", 401);

			return createElement(
				"output",
				null,
				result.kind === AuthGuardResultKind.Redirect ? result.location : "ok",
			);
		}

		const providerProps = {
			config: {
				baseUrl: "https://auth.example.com",
				zones: [{ zonePrefix: "/basic" }],
			},
		} satisfies Omit<BasicAuthContextProviderProps, "children">;

		const view = render(
			createElement(
				BasicAuthContextProvider,
				providerProps as BasicAuthContextProviderProps,
				createElement(Probe),
			),
		);

		expect(view.container.textContent).toBe(
			"https://auth.example.com/basic/login?post_auth_redirect_uri=%2Fbasic%2Fapi%2Fgroups",
		);

		view.unmount();
	});
});
