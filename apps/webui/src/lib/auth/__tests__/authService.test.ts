// @vitest-environment jsdom

import { BASIC_AUTH_CONTEXT_CLIENT } from "@securitydept/basic-auth-context-client-react";
import {
	createFoundationEnvironment,
	createReplaySignal,
	ENVIRONMENT_TOKEN,
	type SecuritydeptInjector,
} from "@securitydept/client";
import { SESSION_CONTEXT_CLIENT } from "@securitydept/session-context-client-react";
import { TOKEN_SET_CLIENT_REGISTRY } from "@securitydept/token-set-context-client-react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	AUTH_SERVICE,
	AuthContextMode,
	AuthService,
	provideAuthService,
	resolveTokenSetClientKey,
} from "../authService";

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

function createAuthServiceFixture() {
	const sessionInfo = createReplaySignal<{
		principal: { subject: string; displayName?: string };
	} | null>();
	sessionInfo.setValue(null);
	const basicAuthenticated = createReplaySignal<boolean>();
	basicAuthenticated.setValue(false);
	const basicBoundarySnapshot = createReplaySignal<{
		authenticated: boolean;
	} | null>();
	basicBoundarySnapshot.setValue(null);
	const tokenAuthenticated = createReplaySignal<boolean>();
	tokenAuthenticated.setValue(false);
	const tokenAuthSnapshot = createReplaySignal<{
		tokens: { accessToken?: string };
		metadata: { principal?: { subject: string; displayName?: string } };
	} | null>();
	tokenAuthSnapshot.setValue(null);
	const tokenAuthorization = createReplaySignal<string | undefined>();
	tokenAuthorization.setValue(undefined);
	const tokenClientSignal = createReplaySignal<unknown>();
	const tokenClient = {
		start: vi.fn(async () => {
			tokenAuthenticated.setValue(true);
		}),
		loginWithRedirect: vi.fn(async () => undefined),
		logout: vi.fn(async () => {
			tokenAuthenticated.setValue(false);
			tokenAuthSnapshot.setValue(null);
		}),
		isAuthenticated: tokenAuthenticated,
		authSnapshot: tokenAuthSnapshot,
		authorizationHeaderValue: tokenAuthorization,
	};
	tokenClientSignal.setValue(tokenClient);
	const session = {
		sessionInfo,
		refresh: vi.fn(async () => {
			const value = {
				principal: { subject: "session-user", displayName: "Session User" },
			};
			sessionInfo.setValue(value);
			return value;
		}),
		loginWithRedirect: vi.fn(async () => undefined),
		logout: vi.fn(async () => {
			sessionInfo.setValue(null);
		}),
	};
	const basic = {
		isAuthenticated: basicAuthenticated,
		boundarySnapshot: basicBoundarySnapshot,
		refresh: vi.fn(async () => {
			basicAuthenticated.setValue(true);
			basicBoundarySnapshot.setValue({ authenticated: true });
			return { authenticated: true };
		}),
		loginWithRedirect: vi.fn(async () => undefined),
		logout: vi.fn(async () => {
			basicAuthenticated.setValue(false);
			basicBoundarySnapshot.setValue(null);
			return { authenticated: false };
		}),
	};
	const registry = {
		clientSignalFor: vi.fn(() => tokenClientSignal),
		initialize: vi.fn(async () => ({ client: tokenClient })),
	};
	const environment = createFoundationEnvironment({});
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
			throw new Error("unexpected token");
		},
	} as SecuritydeptInjector;

	return {
		service: new AuthService(injector),
		sessionInfo,
		session,
		basic,
		registry,
		tokenClient,
		tokenAuthenticated,
		tokenAuthSnapshot,
		tokenAuthorization,
		environment,
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

	it("stores, resolves, and notifies auth mode changes", () => {
		const { service } = createAuthServiceFixture();
		const listener = vi.fn();
		const unsubscribe = service.subscribeMode(listener);

		expect(service.getMode()).toBeNull();
		expect(service.resolveMode()).toBe(AuthContextMode.Session);

		service.setMode(AuthContextMode.Basic);
		expect(service.getMode()).toBe(AuthContextMode.Basic);
		expect(listener).toHaveBeenCalledTimes(1);

		service.clearMode();
		expect(service.getMode()).toBeNull();
		expect(listener).toHaveBeenCalledTimes(2);

		unsubscribe();
		service.setMode(AuthContextMode.TokenSetFrontend);
		expect(listener).toHaveBeenCalledTimes(2);
	});

	it("exposes the resolved auth user through a replay signal", async () => {
		const { service, sessionInfo } = createAuthServiceFixture();

		await expect(service.authUser.whenValue()).resolves.toBeNull();

		sessionInfo.setValue({
			principal: { subject: "session-user", displayName: "Session User" },
		});

		await expect(service.authUser.whenValue()).resolves.toMatchObject({
			type: "session",
			userInfo: {
				subject: "session-user",
				displayName: "Session User",
			},
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
		expect(registry.initialize).toHaveBeenCalledWith(
			resolveTokenSetClientKey(AuthContextMode.TokenSetFrontend),
		);
		expect(tokenClient.start).toHaveBeenCalledTimes(1);
	});

	it("resolves token-set dashboard access from the selected mode", async () => {
		const { service, tokenAuthSnapshot, tokenAuthorization } =
			createAuthServiceFixture();

		service.setMode(AuthContextMode.TokenSetBackend);
		tokenAuthSnapshot.setValue({
			tokens: { accessToken: "at" },
			metadata: {
				principal: { subject: "oidc-user", displayName: "OIDC User" },
			},
		});
		tokenAuthorization.setValue("Bearer at");

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
		const providers = provideAuthService();
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
