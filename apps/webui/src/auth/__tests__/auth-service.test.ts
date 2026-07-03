// @vitest-environment jsdom

import {
	BASIC_AUTH_CONTEXT_CLIENT,
	provideBasicAuthContext,
} from "@securitydept/basic-auth-context-client";
import {
	ClientError,
	ClientErrorKind,
	createEventSubject,
	createFoundationEnvironment,
	createSecuritydeptDestroyRef,
	createSignal,
	ENVIRONMENT_TOKEN,
	INJECTOR_TOKEN,
	REQUIREMENT_PLANNER_HOST,
	RequirementPlannerHost,
	type ResourceSnapshot,
	ResourceStatus,
	resourceFromSnapshots,
	SecuritydeptDestroyRef,
	type SecuritydeptInjector,
} from "@securitydept/client";
import { createEnvironmentForReact } from "@securitydept/client-react";
import {
	provideSessionContext,
	SESSION_CONTEXT_CLIENT,
} from "@securitydept/session-context-client";
import {
	TOKEN_SET_CLIENT_REGISTRY,
	TOKEN_SET_CLIENT_REGISTRY_ENTRIES,
} from "@securitydept/token-set-context-client/registry";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	MESSAGE_SERVICE,
	type MessageService,
} from "@/message/message.service";
import { AUTH_SERVICE, AuthService, provideAuthService } from "../auth.service";
import { basicAuthContextConfig } from "../basic/config";
import { AuthContextMode } from "../model";
import { sessionContextConfig } from "../session/config";
import {
	TOKEN_SET_BACKEND_MODE_CONFIG,
	TOKEN_SET_FRONTEND_MODE_CONFIG,
} from "../token-set/config";
import { provideWebuiTokenSetContext } from "../token-set/providers";
import { TokenSetTracingService } from "../token-set/tracing";

function createAuthServiceFixture() {
	function createResolvedResource<T>(initialValue: T) {
		const snapshot = createSignal<ResourceSnapshot<T>>({
			status: ResourceStatus.Resolved,
			value: initialValue,
		});
		return {
			snapshot,
			resource: resourceFromSnapshots(() => snapshot.get()),
			setSnapshot(value: ResourceSnapshot<T>) {
				snapshot.set(value);
			},
			set(value: T) {
				snapshot.set({ status: ResourceStatus.Resolved, value });
			},
		};
	}

	const sessionState = createResolvedResource<{
		principal: { subject: string; displayName?: string };
	} | null>(null);
	const basicAuthenticated = createResolvedResource(false);
	const basicBoundaryState = createResolvedResource<{
		authenticated: boolean;
	} | null>(null);
	const tokenAuthenticated = createResolvedResource(false);
	const tokenAuthState = createResolvedResource<{
		tokens: { accessToken?: string };
		metadata: { principal?: { subject: string; displayName?: string } };
	} | null>(null);
	const tokenAuthorization = createResolvedResource<string | undefined>(
		undefined,
	);
	const basicEvents = createEventSubject<unknown>();
	const sessionEvents = createEventSubject<unknown>();
	const tokenAuthEvents = createEventSubject<unknown>();
	const frontendTokenAuthEvents = createEventSubject<unknown>();
	const tokenClient = {
		start: vi.fn(async () => {
			tokenAuthenticated.set(true);
		}),
		loginWithRedirect: vi.fn(async () => undefined),
		logout: vi.fn(async () => {
			tokenAuthenticated.set(false);
			tokenAuthState.set(null);
		}),
		isAuthenticated: tokenAuthenticated.resource,
		authSnapshot: tokenAuthState.snapshot,
		authResource: tokenAuthState.resource,
		authorizationHeaderValue: tokenAuthorization.resource,
		authEvents: tokenAuthEvents,
		dispose: vi.fn(),
	};
	const frontendTokenClient = {
		...tokenClient,
		authEvents: frontendTokenAuthEvents,
	};
	const tokenClientState = createResolvedResource(tokenClient);
	const frontendTokenClientState = createResolvedResource(frontendTokenClient);
	const session = {
		sessionSnapshot: sessionState.snapshot,
		sessionResource: sessionState.resource,
		refresh: vi.fn(async () => {
			const value = {
				principal: { subject: "session-user", displayName: "Session User" },
			};
			sessionState.set(value);
			return value;
		}),
		loginWithRedirect: vi.fn(async () => undefined),
		logout: vi.fn(async () => {
			sessionState.set(null);
		}),
		events: sessionEvents,
	};
	const basic = {
		isAuthenticated: basicAuthenticated.resource,
		boundarySnapshot: basicBoundaryState.snapshot,
		boundaryResource: basicBoundaryState.resource,
		refresh: vi.fn(async () => {
			basicAuthenticated.set(true);
			basicBoundaryState.set({ authenticated: true });
			return { authenticated: true };
		}),
		loginWithRedirect: vi.fn(async () => undefined),
		logout: vi.fn(async () => {
			basicAuthenticated.set(false);
			basicBoundaryState.set(null);
			return { authenticated: false };
		}),
		events: basicEvents,
	};
	const registry = {
		clientResourceFor: vi.fn((clientKey: string) =>
			clientKey === TOKEN_SET_BACKEND_MODE_CONFIG.clientKey
				? tokenClientState.resource
				: frontendTokenClientState.resource,
		),
		clientRecordFor: vi.fn(async (clientKey: string) => {
			const client =
				clientKey === TOKEN_SET_BACKEND_MODE_CONFIG.clientKey
					? tokenClient
					: frontendTokenClient;
			await client.start();
			return { client };
		}),
	};
	const environment = createFoundationEnvironment({});
	const destroyRef = createSecuritydeptDestroyRef();
	const messageService = {
		showError: vi.fn(),
	};
	const injector = {
		get(token: unknown) {
			if (token === SESSION_CONTEXT_CLIENT) {
				return session;
			}
			if (token === BASIC_AUTH_CONTEXT_CLIENT) {
				return basic;
			}
			if (token === TOKEN_SET_CLIENT_REGISTRY) {
				return registry;
			}
			if (token === ENVIRONMENT_TOKEN) {
				return environment;
			}
			if (token === SecuritydeptDestroyRef) {
				return destroyRef;
			}
			throw new Error("unexpected token");
		},
	} as SecuritydeptInjector;

	return {
		service: new AuthService(injector, messageService as MessageService),
		sessionState,
		session,
		basic,
		registry,
		tokenClient,
		tokenClientState,
		tokenAuthenticated,
		tokenAuthState,
		tokenAuthorization,
		basicEvents,
		sessionEvents,
		tokenAuthEvents,
		frontendTokenAuthEvents,
		messageService,
		environment,
		destroyRef,
	};
}

describe("AuthService", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("stores and resolves auth mode changes", async () => {
		const { service } = createAuthServiceFixture();

		await expect(service.mode.whenValue()).resolves.toBeNull();

		service.setMode(AuthContextMode.Basic);
		expect(service.mode.value.get()).toBe(AuthContextMode.Basic);

		service.clearMode();
		expect(service.mode.value.get()).toBeNull();
	});

	it("exposes the resolved auth user through a resource", () => {
		const { service, sessionState } = createAuthServiceFixture();
		service.setMode(AuthContextMode.Session);

		expect(service.authUser.value.get()).toBeNull();

		sessionState.set({
			principal: { subject: "session-user", displayName: "Session User" },
		});

		expect(service.authUser.value.get()).toMatchObject({
			type: "session",
			userInfo: {
				displayName: "Session User",
			},
		});
	});

	it("preserves loading and error states from the selected auth resource", () => {
		const { service, sessionState } = createAuthServiceFixture();
		const error = new Error("session probe failed");
		service.setMode(AuthContextMode.Session);

		sessionState.setSnapshot({ status: ResourceStatus.Loading });
		expect(service.authUser.snapshot.get()).toEqual({
			status: ResourceStatus.Loading,
		});

		sessionState.setSnapshot({
			status: ResourceStatus.LoadingError,
			error,
		});
		expect(service.authUser.snapshot.get()).toEqual({
			status: ResourceStatus.LoadingError,
			error,
		});
	});

	it("flattens token-set client and auth snapshots", () => {
		const { service, tokenAuthState, tokenClientState, tokenClient } =
			createAuthServiceFixture();
		const error = new Error("client refresh failed");

		service.setMode(AuthContextMode.TokenSetBackend);
		tokenAuthState.set({
			tokens: { accessToken: "at" },
			metadata: {
				principal: { subject: "oidc-user", displayName: "OIDC User" },
			},
		});
		tokenClientState.setSnapshot({
			status: ResourceStatus.Reloading,
			value: tokenClient,
		});
		expect(service.authUser.snapshot.get()).toMatchObject({
			status: ResourceStatus.Reloading,
			value: {
				type: "token-set-backend-oidc-mode",
				userInfo: { displayName: "OIDC User" },
			},
		});

		tokenClientState.setSnapshot({
			status: ResourceStatus.Error,
			value: tokenClient,
			error,
		});
		expect(service.authUser.snapshot.get()).toMatchObject({
			status: ResourceStatus.Error,
			value: {
				type: "token-set-backend-oidc-mode",
				userInfo: { displayName: "OIDC User" },
			},
			error,
		});
	});

	it("projects an authenticated token-set context without principal metadata", () => {
		const { service, tokenAuthState } = createAuthServiceFixture();

		service.setMode(AuthContextMode.TokenSetBackend);
		tokenAuthState.set({
			tokens: { accessToken: "at" },
			metadata: {},
		});

		expect(service.authUser.value.get()).toMatchObject({
			type: "token-set-backend-oidc-mode",
			userInfo: {
				displayName: "Token Set Backend Mode context",
			},
		});
	});

	it("disposes with the injected Securitydept destroy ref", () => {
		const { service, destroyRef } = createAuthServiceFixture();
		const dispose = vi.spyOn(service, "dispose");

		destroyRef.dispose();

		expect(dispose).toHaveBeenCalledOnce();
	});

	it("forwards auth client error events to the message service", () => {
		const {
			service,
			basicEvents,
			sessionEvents,
			tokenAuthEvents,
			frontendTokenAuthEvents,
			messageService,
		} = createAuthServiceFixture();
		const error = new ClientError({
			kind: ClientErrorKind.Transport,
			code: "test.auth_failed",
			message: "auth failed",
		});

		basicEvents.next({ error });
		sessionEvents.next({ error });
		tokenAuthEvents.next({ payload: { error } });
		frontendTokenAuthEvents.next({ payload: { error } });

		expect(messageService.showError).toHaveBeenCalledTimes(4);
		expect(messageService.showError).toHaveBeenNthCalledWith(1, error);
		expect(messageService.showError).toHaveBeenNthCalledWith(2, error);
		expect(messageService.showError).toHaveBeenNthCalledWith(3, error);
		expect(messageService.showError).toHaveBeenNthCalledWith(4, error);

		service.dispose();
		basicEvents.next({ error });
		expect(messageService.showError).toHaveBeenCalledTimes(4);
	});

	it("checks route authentication through selected context clients", async () => {
		const { service, session, basic, registry, tokenClient } =
			createAuthServiceFixture();

		service.setMode(AuthContextMode.Session);
		expect(await service.ensureAuthenticatedForRoute("/dashboard")).toBe(true);
		expect(session.refresh).toHaveBeenCalledTimes(1);

		service.setMode(AuthContextMode.Basic);
		expect(await service.ensureAuthenticatedForRoute("/dashboard")).toBe(true);
		expect(basic.refresh).toHaveBeenCalledWith({ path: "/basic/api/entries" });

		service.setMode(AuthContextMode.TokenSetFrontend);
		expect(await service.ensureAuthenticatedForRoute("/dashboard")).toBe(true);
		expect(registry.clientRecordFor).toHaveBeenCalledWith(
			TOKEN_SET_FRONTEND_MODE_CONFIG.clientKey,
			{ initialize: true },
		);
		expect(tokenClient.start).toHaveBeenCalledTimes(1);
	});

	it("resolves token-set dashboard access from the selected mode", async () => {
		const { service, tokenAuthState, tokenAuthorization } =
			createAuthServiceFixture();

		service.setMode(AuthContextMode.TokenSetBackend);
		tokenAuthState.set({
			tokens: { accessToken: "at" },
			metadata: {
				principal: { subject: "oidc-user", displayName: "OIDC User" },
			},
		});
		tokenAuthorization.set("Bearer at");

		const access = await service.resolveDashboardAccess();
		expect(access).toMatchObject({
			kind: "token-set",
			mode: AuthContextMode.TokenSetBackend,
		});
	});

	it("dispatches logout to the active context and clears mode", async () => {
		const { service, basic, tokenClient } = createAuthServiceFixture();

		service.setMode(AuthContextMode.Basic);
		await service.logout();
		expect(basic.logout).toHaveBeenCalledWith();
		expect(service.mode.value.get()).toBeNull();

		service.setMode(AuthContextMode.TokenSetFrontend);
		await service.logout();
		expect(tokenClient.logout).toHaveBeenCalledTimes(1);
		expect(service.mode.value.get()).toBeNull();
	});

	it("provides Securitydept providers for the service token", () => {
		const providers = provideAuthService();
		expect(providers).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					provide: AUTH_SERVICE,
					deps: [INJECTOR_TOKEN, MESSAGE_SERVICE],
				}),
				expect.objectContaining({ provide: MESSAGE_SERVICE }),
				expect.objectContaining({
					provide: REQUIREMENT_PLANNER_HOST,
					deps: [AUTH_SERVICE, ENVIRONMENT_TOKEN],
				}),
			]),
		);
		expect(providers).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ provide: AuthService }),
			]),
		);
	});

	it("provides token-set registry entries with an explicit tracing dependency", () => {
		expect(provideWebuiTokenSetContext()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					provide: TOKEN_SET_CLIENT_REGISTRY_ENTRIES,
					deps: [INJECTOR_TOKEN, TokenSetTracingService],
				}),
			]),
		);
	});

	it("resolves the planner host from the production provider graph", () => {
		const environment = createEnvironmentForReact({
			providers: [
				...provideSessionContext({ config: sessionContextConfig }),
				...provideBasicAuthContext({ config: basicAuthContextConfig }),
				...provideWebuiTokenSetContext(),
				...provideAuthService(),
			],
		});

		expect(environment.injector.get(REQUIREMENT_PLANNER_HOST)).toBeInstanceOf(
			RequirementPlannerHost,
		);
		environment.injector.get(AUTH_SERVICE).dispose();
	});
});
