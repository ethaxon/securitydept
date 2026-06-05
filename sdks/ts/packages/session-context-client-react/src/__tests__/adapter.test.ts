// @vitest-environment jsdom

import {
	type BaseTransportTrait,
	type HttpRequest,
	type HttpResponse,
} from "@securitydept/client";
import { createEnvironmentForTest } from "@securitydept/client/test";
import {
	SecuritydeptProvider,
	useResourceValue,
	useSecuritydeptContext,
} from "@securitydept/client-react";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
	provideSessionContext,
	SESSION_CONTEXT_CLIENT,
	SessionContextService,
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
		unmount() {
			act(() => {
				root.unmount();
			});
			container.remove();
		},
	};
}

function createTestTransport(
	handler: (request: HttpRequest) => HttpResponse,
): BaseTransportTrait {
	return {
		async execute(request: HttpRequest) {
			return handler(request);
		},
	};
}

describe("session-context react adapter", () => {
	afterEach(() => {
		document.body.innerHTML = "";
		delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
	});

	it("provides the SessionContextClient through SecuritydeptProvider", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		const environment = createEnvironmentForTest({
			transport: createTestTransport(() => ({
				status: 200,
				headers: {},
				body: { subject: "session-user-1", display_name: "Alice" },
			})),
		});
		let client: SessionContextService | null = null;

		function Probe() {
			const injector = useSecuritydeptContext();
			const resolvedClient = injector.get(SESSION_CONTEXT_CLIENT);
			expect(resolvedClient).toBeInstanceOf(SessionContextService);
			client = resolvedClient as SessionContextService;
			const session = useResourceValue(resolvedClient.sessionResource, {
				initialValue: null,
			});

			return createElement(
				"output",
				null,
				session?.principal.displayName ?? "none",
			);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{
					parentInjector: environment.injector,
					providers: provideSessionContext({
						config: { baseUrl: "https://auth.example.com" },
					}),
				},
				createElement(Probe),
			),
		);

		expect(view.container.textContent).toBe("none");
		await act(async () => {
			await client?.refresh();
		});
		expect(view.container.textContent).toBe("Alice");

		view.unmount();
	});
});
