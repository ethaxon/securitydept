// @vitest-environment jsdom

import {
	type BaseTransportTrait,
	type HttpRequest,
	type HttpResponse,
	ResourceStatus,
} from "@securitydept/client";
import { createEnvironmentForTest } from "@securitydept/client/test";
import {
	SecuritydeptProvider,
	useResourceSnapshot,
} from "@securitydept/client-react";
import {
	provideSessionContext,
	type SessionContextClient,
} from "@securitydept/session-context-client";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useSessionContextClient } from "../index";

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
			providers: provideSessionContext({
				config: { baseUrl: "https://auth.example.com" },
			}),
		});
		let client: SessionContextClient | null = null;

		function Probe() {
			const resolvedClient = useSessionContextClient();
			client = resolvedClient;
			const sessionSnapshot = useResourceSnapshot(
				resolvedClient.sessionResource,
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

			return createElement(
				"output",
				null,
				session?.principal.displayName ?? "none",
			);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ injector: environment.injector },
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
