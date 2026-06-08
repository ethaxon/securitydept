// @vitest-environment jsdom

import { BASIC_AUTH_CONTEXT_CLIENT } from "@securitydept/basic-auth-context-client-react";
import {
	createFoundationEnvironment,
	createSecuritydeptDestroyRef,
	createSignal,
	ENVIRONMENT_TOKEN,
	type ResourceSnapshot,
	ResourceStatus,
	resourceFromSnapshots,
	SecuritydeptDestroyRef,
	type SecuritydeptInjector,
} from "@securitydept/client";
import { SESSION_CONTEXT_CLIENT } from "@securitydept/session-context-client-react";
import { TOKEN_SET_CLIENT_REGISTRY } from "@securitydept/token-set-context-client-react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	AUTH_MODE_STORE,
	AUTH_SERVICE,
	AuthService,
	provideAuthService,
} from "../auth.service";
import { AUTH_MODE_STORAGE_KEY, type AuthModeStore } from "../mode-store";
import { AuthContextMode } from "../model";
import { TOKEN_SET_FRONTEND_MODE_CONFIG } from "../token-set/config";

class MemoryStorage {
	private readonly data = new Map<string, string>();

	getItem(key: string): string | null {
		return this.data.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this.data.set(key, value);
	}

	removeItem(key: string): void {
		this.data.delete(key);
	}

	clear(): void {
		this.data.clear();
	}
}

function createAuthModeStore(): AuthModeStore {
	return {
		read: () => globalThis.localStorage.getItem(AUTH_MODE_STORAGE_KEY),
		write: (value) =>
			globalThis.localStorage.setItem(AUTH_MODE_STORAGE_KEY, value),
		clear: () => globalThis.localStorage.removeItem(AUTH_MODE_STORAGE_KEY),
		subscribe: () => () => undefined,
	};
}

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
		dispose: vi.fn(),
	};
	const tokenClientState = createResolvedResource(tokenClient);
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
	};
	const registry = {
		clientResourceFor: vi.fn(() => tokenClientState.resource),
		clientRecordFor: vi.fn(async () => {
			await tokenClient.start();
			return { client: tokenClient };
		}),
	};
	const environment = createFoundationEnvironment({});
	const modeStore = createAuthModeStore();
	const destroyRef = createSecuritydeptDestroyRef();
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
			if (token === AUTH_MODE_STORE) {
				return modeStore;
			}
			if (token === SecuritydeptDestroyRef) {
				return destroyRef;
			}
			throw new Error("unexpected token");
		},
	} as SecuritydeptInjector;

	return {
		service: new AuthService(injector),
		sessionState,
		session,
		basic,
		registry,
		tokenClient,
		tokenAuthenticated,
		tokenAuthState,
		tokenAuthorization,
		environment,
		destroyRef,
	};
}

describe("AuthService", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		Object.defineProperty(globalThis, "localStorage", {
			value: new MemoryStorage(),
			configurable: true,
			writable: true,
		});
	});

	it("stores and resolves auth mode changes", () => {
		const { service } = createAuthServiceFixture();

		expect(service.getMode()).toBeNull();
		expect(service.resolveMode()).toBe(AuthContextMode.Session);

		service.setMode(AuthContextMode.Basic);
		expect(service.getMode()).toBe(AuthContextMode.Basic);
		expect(service.mode.get()).toBe(AuthContextMode.Basic);

		service.clearMode();
		expect(service.getMode()).toBeNull();
		expect(service.mode.get()).toBe(AuthContextMode.Session);
	});

	it("exposes the resolved auth user through a resource", () => {
		const { service, sessionState } = createAuthServiceFixture();

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

	it("disposes with the injected Securitydept destroy ref", () => {
		const { service, destroyRef } = createAuthServiceFixture();

		destroyRef.dispose();

		expect(service.authUser.snapshot.get()).toEqual({
			status: ResourceStatus.Idle,
		});
	});

	it("checks route authentication through selected context clients", async () => {
		const { service, session, basic, registry, tokenClient } =
			createAuthServiceFixture();

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
		expect(basic.logout).toHaveBeenCalledWith({ zonePrefix: "/basic" });
		expect(service.getMode()).toBeNull();

		service.setMode(AuthContextMode.TokenSetFrontend);
		await service.logout();
		expect(tokenClient.logout).toHaveBeenCalledTimes(1);
		expect(service.getMode()).toBeNull();
	});

	it("provides Securitydept providers for the service token", () => {
		const providers = provideAuthService({
			authModeStore: createAuthModeStore(),
		});
		expect(providers).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ provide: AuthService }),
				expect.objectContaining({
					provide: AUTH_SERVICE,
					useExisting: AuthService,
				}),
			]),
		);
	});
});
