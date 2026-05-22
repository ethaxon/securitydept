// @vitest-environment jsdom

import {
	createReplaySignal,
	createSignal,
	createSubject,
} from "@securitydept/client";
import {
	SecuritydeptProvider,
	useReadableSignal,
	useSecuritydeptContext,
} from "@securitydept/client-react";
import type {
	AuthSnapshot,
	TokenSetAuthEvent,
} from "@securitydept/token-set-context-client/orchestration";
import {
	AuthCheckStatus,
	TokenFreshnessState,
	TokenSetAuthFlowReason,
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

function createSnapshot(accessToken: string): AuthSnapshot {
	return {
		tokens: { accessToken },
		metadata: {},
	};
}

function authCheckResult(snapshot: AuthSnapshot | null) {
	if (!snapshot) {
		return {
			status: AuthCheckStatus.Unauthenticated,
			snapshot: null,
			authorizationHeader: null,
			reason: TokenSetAuthFlowReason.NoSnapshot,
		};
	}

	return {
		status: AuthCheckStatus.Authenticated,
		snapshot,
		freshness: TokenFreshnessState.Fresh,
		authorizationHeader: `Bearer ${snapshot.tokens.accessToken}`,
	};
}

function createRegistryOptions(accessToken: string) {
	const state = createSignal<AuthSnapshot | null>(createSnapshot(accessToken));
	const authSnapshot = createReplaySignal<AuthSnapshot | null>();
	authSnapshot.emit(state.get());
	const isAuthenticated = createReplaySignal<boolean>();
	isAuthenticated.emit(true);
	const authorizationHeaderValue = createReplaySignal<string | undefined>();
	authorizationHeaderValue.emit(`Bearer ${accessToken}`);
	const authDetermined = createReplaySignal<true>();
	authDetermined.emit(true);
	const lastAuthError = createSignal<unknown | undefined>(undefined);
	state.subscribe(() => {
		const snapshot = state.get();
		authSnapshot.emit(snapshot);
		isAuthenticated.emit(Boolean(snapshot?.tokens.accessToken));
		authorizationHeaderValue.emit(
			snapshot?.tokens.accessToken
				? `Bearer ${snapshot.tokens.accessToken}`
				: undefined,
		);
	});
	return {
		state,
		clients: [
			{
				key: "main",
				clientFactory: () => ({
					authDetermined,
					authSnapshot,
					isAuthenticated,
					authorizationHeaderValue,
					lastAuthError,
					authOperations: {
						restorePending: createSignal(false),
						refreshPending: createSignal(false),
						clearPending: createSignal(false),
						loginPending: createSignal(false),
					},
					authEvents: createSubject<TokenSetAuthEvent>(),
					addAuthCheckTriggerSource: () => ({ unsubscribe: () => undefined }),
					start: async () => undefined,
					dispose: () => state.set(null),
					restorePersistedState: async () => state.get(),
					authCheck: async () => authCheckResult(state.get()),
					handleCallback: async () => ({
						snapshot: createSnapshot(accessToken),
					}),
					loginWithRedirect: async () => undefined,
				}),
			},
		] satisfies readonly TokenSetClientEntry[],
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

describe("token-set react adapter", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("reads registry-backed auth state through SecuritydeptProvider", async () => {
		const { clients, state } = createRegistryOptions("main-at");

		function Probe() {
			const registry = useSecuritydeptContext().get(TOKEN_SET_AUTH_REGISTRY);
			const clientSlot = useReadableSignal(registry.clientSignalFor("main"));
			return clientSlot.kind === "value"
				? createElement(ClientStateProbe, { client: clientSlot.value })
				: createElement("output", null, "empty");
		}

		function ClientStateProbe({ client }: { client: TokenSetReactClient }) {
			const authState = useReadableSignal(client.authSnapshot);
			return createElement(
				"output",
				null,
				authState.kind === "value"
					? (authState.value?.tokens.accessToken ?? "empty")
					: "empty",
			);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ providers: [provideTokenSetAuthRegistry({ clients })] },
				createElement(Probe),
			),
		);
		await act(async () => {
			await Promise.resolve();
		});

		expect(view.container.textContent).toBe("main-at");

		act(() => {
			state.set(createSnapshot("updated-at"));
		});

		expect(view.container.textContent).toBe("updated-at");

		await act(async () => {
			view.unmount();
			await Promise.resolve();
		});
		expect(state.get()).toBeNull();
	});

	it("supports nested injector overrides for token-set registries", async () => {
		const parent = createRegistryOptions("parent-at");
		const child = createRegistryOptions("child-at");

		function Probe({ label }: { label: string }) {
			const registry = useSecuritydeptContext().get(TOKEN_SET_AUTH_REGISTRY);
			const clientSlot = useReadableSignal(registry.clientSignalFor("main"));
			return clientSlot.kind === "value"
				? createElement(LabeledClientStateProbe, {
						client: clientSlot.value,
						label,
					})
				: createElement("output", null, `${label}:empty`);
		}

		function LabeledClientStateProbe({
			client,
			label,
		}: {
			client: TokenSetReactClient;
			label: string;
		}) {
			const authState = useReadableSignal(client.authSnapshot);
			return createElement(
				"output",
				null,
				`${label}:${
					authState.kind === "value"
						? (authState.value?.tokens.accessToken ?? "empty")
						: "empty"
				}`,
			);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{
					providers: [provideTokenSetAuthRegistry({ clients: parent.clients })],
				},
				createElement(Probe, { label: "parent" }),
				createElement(
					SecuritydeptProvider,
					{
						providers: [
							provideTokenSetAuthRegistry({ clients: child.clients }),
						],
					},
					createElement(Probe, { label: "child" }),
				),
			),
		);
		await act(async () => {
			await Promise.resolve();
		});

		expect(view.container.textContent).toBe("parent:parent-atchild:child-at");

		await act(async () => {
			view.unmount();
			await Promise.resolve();
		});
		expect(parent.state.get()).toBeNull();
		expect(child.state.get()).toBeNull();
	});

	it("treats manual registry ownership as advanced usage that requires explicit dispose", async () => {
		const { clients, state } = createRegistryOptions("manual-at");
		const registry = createManualRegistry(clients);
		await registry.whenReady("main");

		function Probe() {
			const registry = useSecuritydeptContext().get(TOKEN_SET_AUTH_REGISTRY);
			const clientSlot = useReadableSignal(registry.clientSignalFor("main"));
			const slot =
				clientSlot.kind === "value"
					? clientSlot.value.authSnapshot.get()
					: { kind: "empty" as const };
			return createElement(
				"output",
				null,
				slot.kind === "value"
					? (slot.value?.tokens.accessToken ?? "empty")
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

		expect(view.container.textContent).toBe("manual-at");
		view.unmount();
		expect(state.get()?.tokens.accessToken).toBe("manual-at");

		registry.dispose();
		expect(state.get()).toBeNull();
	});
});
