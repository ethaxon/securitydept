// @vitest-environment jsdom

import { createSignal, createSubject } from "@securitydept/client";
import {
	SecuritydeptProvider,
	useReadableSignal,
	useSecuritydeptContext,
} from "@securitydept/client-react";
import type {
	AuthSnapshot,
	TokenSetAuthEvent,
} from "@securitydept/token-set-context-client/orchestration";
import { createTokenSetOidcAuthRegistry } from "@securitydept/token-set-context-client/registry";
import {
	provideTokenSetAuthRegistry,
	type ReactRegistry,
	TOKEN_SET_AUTH_REGISTRY,
	type TokenSetClientEntry,
	type TokenSetReactClient,
} from "@securitydept/token-set-context-client-react";
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { createTestTokenSetReactiveFields } from "./test-token-set-client";

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

function createSnapshot(accessToken: string): AuthSnapshot {
	return {
		tokens: { accessToken },
		metadata: {},
	};
}

function createClient(
	state: ReturnType<typeof createSignal<AuthSnapshot | null>>,
) {
	const reactive = createTestTokenSetReactiveFields(state.get());
	state.subscribe(() => reactive.emitSnapshot(state.get()));
	return {
		...reactive.fields,
		authEvents: createSubject<TokenSetAuthEvent>(),
		addAuthCheckTriggerSource: () => ({ unsubscribe: () => undefined }),
		start: async () => undefined,
		dispose: () => {
			state.set(null);
			reactive.emitSnapshot(null);
		},
		restorePersistedState: async () => state.get(),
		handleCallback: async () => ({ snapshot: state.get()! }),
		loginWithRedirect: async () => undefined,
	};
}

function createManualRegistry(
	clients: readonly TokenSetClientEntry[],
): ReactRegistry {
	const registry = createTokenSetOidcAuthRegistry<TokenSetReactClient>();

	for (const client of clients) {
		const registration = registry.register(client);
		if (registration instanceof Promise) {
			registration.catch(() => {});
		}
	}

	return registry;
}

describe("react multi-client registry baseline", () => {
	it("surfaces multiple keyed clients through SecuritydeptProvider", async () => {
		const mainState = createSignal<AuthSnapshot | null>(
			createSnapshot("main-at"),
		);
		const adminState = createSignal<AuthSnapshot | null>(
			createSnapshot("admin-at"),
		);
		const registry = createManualRegistry([
			{
				key: "main",
				clientFactory: () => createClient(mainState),
			},
			{
				key: "admin",
				clientFactory: () => createClient(adminState),
			},
		]);
		await registry.whenReady("main");
		await registry.whenReady("admin");

		function Probe() {
			const registry = useSecuritydeptContext().get(TOKEN_SET_AUTH_REGISTRY);
			const mainClient = useReadableSignal(registry.clientSignalFor("main"));
			const adminClient = useReadableSignal(registry.clientSignalFor("admin"));
			return mainClient.kind === "value" && adminClient.kind === "value"
				? createElement(MultiClientProbe, {
						mainClient: mainClient.value,
						adminClient: adminClient.value,
					})
				: createElement("output", null, "empty:empty");
		}

		function MultiClientProbe({
			mainClient,
			adminClient,
		}: {
			mainClient: TokenSetReactClient;
			adminClient: TokenSetReactClient;
		}) {
			const main = useReadableSignal(mainClient.authSnapshot);
			const admin = useReadableSignal(adminClient.authSnapshot);
			return createElement(
				"output",
				null,
				`${
					main.kind === "value"
						? (main.value?.tokens.accessToken ?? "empty")
						: "empty"
				}:${
					admin.kind === "value"
						? (admin.value?.tokens.accessToken ?? "empty")
						: "empty"
				}`,
			);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ providers: [provideTokenSetAuthRegistry(registry)] },
				createElement(Probe),
			),
		);

		expect(view.container.textContent).toBe("main-at:admin-at");
		view.unmount();
		registry.dispose();
	});

	it("re-renders when a keyed client signal changes", async () => {
		const mainState = createSignal<AuthSnapshot | null>(
			createSnapshot("main-at"),
		);
		const registry = createManualRegistry([
			{
				key: "main",
				clientFactory: () => createClient(mainState),
			},
		]);
		await registry.whenReady("main");

		function Probe() {
			const registry = useSecuritydeptContext().get(TOKEN_SET_AUTH_REGISTRY);
			const clientSlot = useReadableSignal(registry.clientSignalFor("main"));
			return clientSlot.kind === "value"
				? createElement(SingleClientProbe, { client: clientSlot.value })
				: createElement("output", null, "empty");
		}

		function SingleClientProbe({ client }: { client: TokenSetReactClient }) {
			const snapshot = useReadableSignal(client.authSnapshot);
			return createElement(
				"output",
				null,
				snapshot.kind === "value"
					? (snapshot.value?.tokens.accessToken ?? "empty")
					: "empty",
			);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ providers: [provideTokenSetAuthRegistry(registry)] },
				createElement(Probe),
			),
		);

		act(() => {
			mainState.set(createSnapshot("updated-at"));
		});

		expect(view.container.textContent).toBe("updated-at");
		view.unmount();
		registry.dispose();
	});
});
