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
	TokenSetAuthFlowReason,
} from "@securitydept/token-set-context-client/orchestration";
import {
	TokenSetAuthService as CoreTokenSetAuthService,
	createTokenSetAuthRegistry,
} from "@securitydept/token-set-context-client/registry";
import {
	CallbackResumeStatus,
	provideTokenSetAuthRegistry,
	provideTokenSetCallbackResumeController,
	type ReactRegistry,
	TOKEN_SET_CALLBACK_RESUME_CONTROLLER,
	type TokenSetClientEntry,
	type TokenSetReactClient,
	useTokenSetCallbackResume,
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

describe("react callback async readiness", () => {
	it("resumes callback from a controller resolved through SecuritydeptProvider", async () => {
		const state = createSignal<AuthSnapshot | null>(null);
		const registry = createManualRegistry([
			{
				key: "frontend",
				callbackPath: "/oidc/callback",
				autoRestore: false,
				clientFactory: async () => ({
					state,
					authEvents: createSubject<TokenSetAuthEvent>(),
					dispose: () => state.set(null),
					restorePersistedState: async () => state.get(),
					authorizationHeader: () => null,
					ensureAuthForResource: async () => ({
						status: EnsureAuthForResourceStatus.Unauthenticated,
						snapshot: null,
						authorizationHeader: null,
						reason: TokenSetAuthFlowReason.NoSnapshot,
					}),
					ensureFreshAuthState: async () => state.get(),
					ensureAuthorizationHeader: async () => null,
					handleCallback: async () => {
						const snapshot = createSnapshot("callback-at");
						state.set(snapshot);
						return { snapshot, postAuthRedirectUri: "/after-login" };
					},
					loginWithRedirect: async () => undefined,
				}),
			},
		]);

		function Probe() {
			const controller = useSecuritydeptContext().get(
				TOKEN_SET_CALLBACK_RESUME_CONTROLLER,
			);
			const resumeState = useTokenSetCallbackResume({
				controller,
				getCurrentUrl: () =>
					"https://app.example.com/oidc/callback?code=ok&state=s1",
			});
			return createElement("output", null, resumeState.status);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{
					providers: [
						provideTokenSetAuthRegistry(registry),
						provideTokenSetCallbackResumeController(registry),
					],
				},
				createElement(Probe),
			),
		);

		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(view.container.textContent).toBe(CallbackResumeStatus.Resolved);
		view.unmount();
		registry.dispose();
	});

	it("returns idle when the current URL is not a callback", () => {
		const registry = createManualRegistry([]);

		function Probe() {
			const controller = useSecuritydeptContext().get(
				TOKEN_SET_CALLBACK_RESUME_CONTROLLER,
			);
			const resumeState = useTokenSetCallbackResume({
				controller,
				getCurrentUrl: () => "https://app.example.com/not-a-callback",
			});
			return createElement("output", null, resumeState.status);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{
					providers: [
						provideTokenSetAuthRegistry(registry),
						provideTokenSetCallbackResumeController(registry),
					],
				},
				createElement(Probe),
			),
		);

		expect(view.container.textContent).toBe(CallbackResumeStatus.Idle);
		view.unmount();
		registry.dispose();
	});
});
