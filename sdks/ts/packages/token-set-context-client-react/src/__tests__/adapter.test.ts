// @vitest-environment jsdom

import {
	createDefaultIdleScheduler,
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
	EnsureAuthForResourceStatus,
	TokenFreshnessState,
	TokenSetAuthFlowReason,
} from "@securitydept/token-set-context-client/orchestration";
import {
	TokenSetAuthService as CoreTokenSetAuthService,
	createTokenSetAuthRegistry,
} from "@securitydept/token-set-context-client/registry";
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

function ensureAuthResult(snapshot: AuthSnapshot | null) {
	if (!snapshot) {
		return {
			status: EnsureAuthForResourceStatus.Unauthenticated,
			snapshot: null,
			authorizationHeader: null,
			reason: TokenSetAuthFlowReason.NoSnapshot,
		};
	}

	return {
		status: EnsureAuthForResourceStatus.Authenticated,
		snapshot,
		freshness: TokenFreshnessState.Fresh,
		authorizationHeader: `Bearer ${snapshot.tokens.accessToken}`,
	};
}

function createRegistryOptions(accessToken: string) {
	const state = createSignal<AuthSnapshot | null>(createSnapshot(accessToken));
	return {
		state,
		clients: [
			{
				key: "main",
				autoRestore: false,
				clientFactory: () => ({
					state,
					authEvents: createSubject<TokenSetAuthEvent>(),
					dispose: () => state.set(null),
					restorePersistedState: async () => state.get(),
					authorizationHeader: () =>
						`Bearer ${state.get()?.tokens.accessToken ?? ""}`,
					ensureAuthForResource: async () => ensureAuthResult(state.get()),
					ensureFreshAuthState: async () => state.get(),
					ensureAuthorizationHeader: async () =>
						state.get()?.tokens.accessToken
							? `Bearer ${state.get()?.tokens.accessToken}`
							: null,
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
	const registry = createTokenSetAuthRegistry<
		TokenSetReactClient,
		CoreTokenSetAuthService<TokenSetReactClient>
	>({
		materialize: CoreTokenSetAuthService.materializeService,
		dispose: CoreTokenSetAuthService.dispose,
		accessTokenOf: CoreTokenSetAuthService.accessTokenOf,
		ensureAccessTokenOf: CoreTokenSetAuthService.ensureAccessTokenOf,
		ensureAuthorizationHeaderOf:
			CoreTokenSetAuthService.ensureAuthorizationHeaderOf,
		ensureAuthForResourceOf: CoreTokenSetAuthService.ensureAuthForResourceOf,
		authEventsOf: CoreTokenSetAuthService.authEventsOf,
		idleScheduler: createDefaultIdleScheduler(),
	});

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
			const service = registry.require("main");
			const authState = useReadableSignal(service.state);
			return createElement(
				"output",
				null,
				authState.snapshot?.tokens.accessToken ?? "empty",
			);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ providers: [provideTokenSetAuthRegistry({ clients })] },
				createElement(Probe),
			),
		);

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
			const service = registry.require("main");
			const authState = useReadableSignal(service.state);
			return createElement(
				"output",
				null,
				`${label}:${authState.snapshot?.tokens.accessToken ?? "empty"}`,
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
			return createElement(
				"output",
				null,
				registry.require("main").accessToken.get(),
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
