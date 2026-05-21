// @vitest-environment jsdom

import {
	createDefaultIdleScheduler,
	createSignal,
	createSubject,
} from "@securitydept/client";
import {
	SecuritydeptProvider,
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
	provideTokenSetCallbackResumeController,
	type ReactRegistry,
	TOKEN_SET_AUTH_REGISTRY,
	TOKEN_SET_CALLBACK_RESUME_CONTROLLER,
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
		authorizationHeader: "Bearer main-at",
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

describe("token-set injector factories", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("exposes registry and callback-controller tokens through explicit SecuritydeptProvider composition", async () => {
		const state = createSignal<AuthSnapshot | null>(createSnapshot("main-at"));
		const registry = createManualRegistry([
			{
				key: "main",
				autoRestore: false,
				clientFactory: () => ({
					state,
					authEvents: createSubject<TokenSetAuthEvent>(),
					dispose: () => state.set(null),
					restorePersistedState: async () => state.get(),
					authorizationHeader: () => "Bearer main-at",
					ensureAuthForResource: async () => ensureAuthResult(state.get()),
					ensureFreshAuthState: async () => state.get(),
					ensureAuthorizationHeader: async () => "Bearer main-at",
					handleCallback: async () => ({
						snapshot: createSnapshot("main-at"),
					}),
					loginWithRedirect: async () => undefined,
				}),
			},
		]);
		const providers = [
			provideTokenSetAuthRegistry(registry),
			provideTokenSetCallbackResumeController(registry),
		] as const;

		function Probe() {
			const injector = useSecuritydeptContext();
			const registry = injector.get(TOKEN_SET_AUTH_REGISTRY);
			const controller = injector.get(TOKEN_SET_CALLBACK_RESUME_CONTROLLER);
			return createElement(
				"output",
				null,
				`${registry.require("main").accessToken.get() ?? "empty"}:${controller.state.get().status}`,
			);
		}

		const view = render(
			createElement(SecuritydeptProvider, { providers }, createElement(Probe)),
		);

		expect(view.container.textContent).toContain("main-at");
		await act(async () => {
			view.unmount();
			await Promise.resolve();
		});
		expect(state.get()?.tokens.accessToken).toBe("main-at");
		registry.dispose();
		expect(state.get()).toBeNull();
	});
});
