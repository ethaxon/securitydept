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
		authorizationHeader: "Bearer main-at",
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

describe("token-set injector factories", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("exposes registry and callback-controller tokens through explicit SecuritydeptProvider composition", async () => {
		const state = createSignal<AuthSnapshot | null>(createSnapshot("main-at"));
		const authSnapshot = createReplaySignal<AuthSnapshot | null>();
		authSnapshot.emit(state.get());
		const isAuthenticated = createReplaySignal<boolean>();
		isAuthenticated.emit(true);
		const authorizationHeaderValue = createReplaySignal<string | undefined>();
		authorizationHeaderValue.emit("Bearer main-at");
		const authDetermined = createReplaySignal<true>();
		authDetermined.emit(true);
		const lastAuthError = createSignal<unknown | undefined>(undefined);
		const registry = createManualRegistry([
			{
				key: "main",
				clientFactory: () => ({
					state,
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
			const clientSlot = useReadableSignal(registry.clientSignalFor("main"));
			const slot =
				clientSlot.kind === "value"
					? clientSlot.value.authSnapshot.get()
					: { kind: "empty" as const };
			return createElement(
				"output",
				null,
				`${slot.kind === "value" ? (slot.value?.tokens.accessToken ?? "empty") : "empty"}:${controller.state.get().status}`,
			);
		}

		const view = render(
			createElement(SecuritydeptProvider, { providers }, createElement(Probe)),
		);
		await act(async () => {
			await Promise.resolve();
		});

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
