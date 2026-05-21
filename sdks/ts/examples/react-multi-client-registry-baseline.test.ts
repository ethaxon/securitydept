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
import { describe, expect, it } from "vitest";

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
	return {
		state,
		authEvents: createSubject<TokenSetAuthEvent>(),
		dispose: () => state.set(null),
		restorePersistedState: async () => state.get(),
		authorizationHeader: () =>
			`Bearer ${state.get()?.tokens.accessToken ?? ""}`,
		ensureAuthForResource: async () => {
			const snapshot = state.get();
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
		},
		ensureFreshAuthState: async () => state.get(),
		ensureAuthorizationHeader: async () =>
			state.get()?.tokens.accessToken
				? `Bearer ${state.get()?.tokens.accessToken}`
				: null,
		handleCallback: async () => ({ snapshot: state.get()! }),
		loginWithRedirect: async () => undefined,
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

describe("react multi-client registry baseline", () => {
	it("surfaces multiple keyed services through SecuritydeptProvider", async () => {
		const mainState = createSignal<AuthSnapshot | null>(
			createSnapshot("main-at"),
		);
		const adminState = createSignal<AuthSnapshot | null>(
			createSnapshot("admin-at"),
		);
		const registry = createManualRegistry([
			{
				key: "main",
				autoRestore: false,
				clientFactory: () => createClient(mainState),
			},
			{
				key: "admin",
				autoRestore: false,
				clientFactory: () => createClient(adminState),
			},
		]);
		await registry.whenReady("main");
		await registry.whenReady("admin");

		function Probe() {
			const registry = useSecuritydeptContext().get(TOKEN_SET_AUTH_REGISTRY);
			const main = useReadableSignal(registry.require("main").state).snapshot;
			const admin = useReadableSignal(registry.require("admin").state).snapshot;
			return createElement(
				"output",
				null,
				`${main?.tokens.accessToken ?? "empty"}:${admin?.tokens.accessToken ?? "empty"}`,
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

	it("re-renders when a keyed service signal changes", async () => {
		const mainState = createSignal<AuthSnapshot | null>(
			createSnapshot("main-at"),
		);
		const registry = createManualRegistry([
			{
				key: "main",
				autoRestore: false,
				clientFactory: () => createClient(mainState),
			},
		]);
		await registry.whenReady("main");

		function Probe() {
			const registry = useSecuritydeptContext().get(TOKEN_SET_AUTH_REGISTRY);
			const snapshot = useReadableSignal(
				registry.require("main").state,
			).snapshot;
			return createElement(
				"output",
				null,
				snapshot?.tokens.accessToken ?? "empty",
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
