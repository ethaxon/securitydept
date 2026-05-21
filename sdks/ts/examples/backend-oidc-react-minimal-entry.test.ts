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
	type TokenSetBackendOidcClient,
	type TokenSetClientEntry,
} from "@securitydept/token-set-context-client-react";
import { act, createElement, type ReactElement } from "react";
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

function createSnapshot(accessToken: string): AuthSnapshot {
	return {
		tokens: { accessToken },
		metadata: {},
	};
}

function createBackendClient(
	snapshot: AuthSnapshot,
): TokenSetBackendOidcClient {
	const state = createSignal<AuthSnapshot | null>(snapshot);
	return {
		state,
		authEvents: createSubject<TokenSetAuthEvent>(),
		dispose: vi.fn(() => state.set(null)),
		restorePersistedState: async () => state.get(),
		authorizationHeader: () =>
			`Bearer ${state.get()?.tokens.accessToken ?? ""}`,
		ensureAuthForResource: async () => {
			const currentSnapshot = state.get();
			if (!currentSnapshot) {
				return {
					status: EnsureAuthForResourceStatus.Unauthenticated,
					snapshot: null,
					authorizationHeader: null,
					reason: TokenSetAuthFlowReason.NoSnapshot,
				};
			}

			return {
				status: EnsureAuthForResourceStatus.Authenticated,
				snapshot: currentSnapshot,
				freshness: TokenFreshnessState.Fresh,
				authorizationHeader: `Bearer ${currentSnapshot.tokens.accessToken}`,
			};
		},
		ensureFreshAuthState: async () => state.get(),
		ensureAuthorizationHeader: async () =>
			`Bearer ${snapshot.tokens.accessToken}`,
		handleCallback: async () => ({ snapshot }),
		loginWithRedirect: async () => undefined,
		authorizeUrl: () => "/authorize",
		refresh: async () => snapshot,
		clearState: async () => {
			state.set(null);
		},
	};
}

type BackendClientEntry = Omit<TokenSetClientEntry, "clientFactory"> & {
	clientFactory: () =>
		| TokenSetBackendOidcClient
		| Promise<TokenSetBackendOidcClient>;
};

function createManualRegistry(
	clients: readonly BackendClientEntry[],
): ReactRegistry {
	const registry = createTokenSetAuthRegistry<
		TokenSetBackendOidcClient,
		CoreTokenSetAuthService<TokenSetBackendOidcClient>
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

describe("backend-oidc react minimal entry", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("shows the minimal injector path for consuming backend-OIDC auth state in React", async () => {
		const registry = createManualRegistry([
			{
				key: "main",
				autoRestore: false,
				clientFactory: () => createBackendClient(createSnapshot("backend-at")),
			},
		]);
		await registry.whenReady("main");

		function AuthBadge() {
			const registry = useSecuritydeptContext().get(TOKEN_SET_AUTH_REGISTRY);
			const snapshot = useReadableSignal(
				registry.require("main").state,
			).snapshot;
			return createElement(
				"output",
				null,
				snapshot ? `token:${snapshot.tokens.accessToken}` : "unauthenticated",
			);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ providers: [provideTokenSetAuthRegistry(registry)] },
				createElement(AuthBadge),
			),
		);

		expect(view.container.textContent).toBe("token:backend-at");
		view.unmount();
		registry.dispose();
	});

	it("shows advanced client access through the keyed registry service", async () => {
		const registry = createManualRegistry([
			{
				key: "main",
				autoRestore: false,
				clientFactory: () => createBackendClient(createSnapshot("backend-at")),
			},
		]);
		await registry.whenReady("main");

		function ClientProbe() {
			const registry = useSecuritydeptContext().get(TOKEN_SET_AUTH_REGISTRY);
			const client = registry.require("main").client;
			if (
				!("authorizeUrl" in client) ||
				typeof client.authorizeUrl !== "function"
			) {
				throw new Error("Expected backend-specific client surface");
			}
			return createElement(
				"output",
				null,
				(client as TokenSetBackendOidcClient).authorizeUrl(),
			);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ providers: [provideTokenSetAuthRegistry(registry)] },
				createElement(ClientProbe),
			),
		);

		expect(view.container.textContent).toBe("/authorize");
		view.unmount();
		registry.dispose();
	});
});
