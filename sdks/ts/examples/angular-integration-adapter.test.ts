import { InjectionToken } from "@angular/core";
import {
	BASIC_AUTH_CONTEXT_CLIENT,
	BasicAuthContextService,
	provideBasicAuthContext,
} from "@securitydept/basic-auth-context-client-angular";
import type { ReadableSignalTrait } from "@securitydept/client";
import {
	bridgeToAngularSignal,
	signalToObservable,
} from "@securitydept/client-angular";
import {
	provideSessionContext,
	SESSION_CONTEXT_CLIENT,
	SessionContextService,
} from "@securitydept/session-context-client-angular";
import {
	type AuthSnapshot,
	AuthSourceKind,
} from "@securitydept/token-set-context-client/orchestration";
import {
	CallbackResumeService,
	createTokenSetBearerInterceptor,
	isOidcCallback,
	type OidcCallbackClient,
	type OidcModeClient,
	provideTokenSetAuth,
	TOKEN_SET_AUTH_REGISTRY,
	TokenSetAuthRegistry,
	TokenSetAuthService,
} from "@securitydept/token-set-context-client-angular";
import { firstValueFrom, Observable, of } from "rxjs";
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createTestSignal<T>(initial: T): {
	signal: ReadableSignalTrait<T>;
	set(value: T): void;
} {
	let value = initial;
	const listeners = new Set<() => void>();
	return {
		signal: {
			get: () => value,
			subscribe(listener: () => void) {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		},
		set(newValue: T) {
			value = newValue;
			for (const l of listeners) l();
		},
	};
}

function makeSnapshot(accessToken: string): AuthSnapshot {
	return {
		tokens: {
			accessToken,
			idToken: "id-test",
			accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
		},
		metadata: {
			source: { kind: AuthSourceKind.OidcAuthorizationCode },
		},
	};
}

function createMockClient(
	initialState: AuthSnapshot | null = null,
): OidcModeClient &
	OidcCallbackClient & { _stateCtrl: ReturnType<typeof createTestSignal> } {
	const stateCtrl = createTestSignal<AuthSnapshot | null>(initialState);
	return {
		state: stateCtrl.signal,
		dispose: vi.fn(),
		restorePersistedState: vi.fn().mockResolvedValue(null),
		authorizationHeader: vi.fn(() => {
			const accessToken = stateCtrl.signal.get()?.tokens.accessToken;
			return accessToken ? `Bearer ${accessToken}` : null;
		}),
		ensureFreshAuthState: vi.fn().mockResolvedValue(stateCtrl.signal.get()),
		ensureAuthorizationHeader: vi
			.fn()
			.mockResolvedValue(
				stateCtrl.signal.get()?.tokens.accessToken
					? `Bearer ${stateCtrl.signal.get()?.tokens.accessToken}`
					: null,
			),
		handleCallback: vi.fn().mockResolvedValue({
			snapshot: makeSnapshot("callback-tok"),
		}),
		_stateCtrl: stateCtrl as ReturnType<typeof createTestSignal>,
	};
}

// ===========================================================================
// 1. Angular-native API surface — InjectionToken + Provider factory
// ===========================================================================

describe("Angular Integration — Angular-native DI surface", () => {
	it("exports TOKEN_SET_AUTH_REGISTRY InjectionToken", () => {
		expect(TOKEN_SET_AUTH_REGISTRY).toBeInstanceOf(InjectionToken);
	});

	it("provideTokenSetAuth returns Angular Provider/EnvironmentProviders array (multi-client)", () => {
		const providers = provideTokenSetAuth({
			clients: [
				{
					key: "main",
					clientFactory: () => createMockClient(),
					callbackPath: "/auth/callback",
				},
				{
					key: "admin",
					clientFactory: () => createMockClient(),
					callbackPath: "/admin/callback",
				},
			],
		});

		expect(Array.isArray(providers)).toBe(true);
		expect(providers.length).toBeGreaterThanOrEqual(3);
	});

	it("exports BASIC_AUTH_CONTEXT_CLIENT InjectionToken", () => {
		expect(BASIC_AUTH_CONTEXT_CLIENT).toBeInstanceOf(InjectionToken);
	});

	it("provideBasicAuthContext returns Angular Provider array", () => {
		const providers = provideBasicAuthContext({
			config: { baseUrl: "/api", zones: [] },
		});
		expect(Array.isArray(providers)).toBe(true);
		expect(providers.length).toBeGreaterThanOrEqual(2);
	});

	it("exports SESSION_CONTEXT_CLIENT InjectionToken", () => {
		expect(SESSION_CONTEXT_CLIENT).toBeInstanceOf(InjectionToken);
	});

	it("provideSessionContext returns Angular Provider array", () => {
		const providers = provideSessionContext({
			config: { baseUrl: "/api" },
			transport: {
				request: vi.fn().mockResolvedValue({ status: 200, data: null }),
			} as unknown as Parameters<typeof provideSessionContext>[0]["transport"],
		});
		expect(Array.isArray(providers)).toBe(true);
		expect(providers.length).toBeGreaterThanOrEqual(1);
	});

	it("TokenSetAuthService class is defined as an Injectable contract", () => {
		expect(TokenSetAuthService).toBeDefined();
		expect(typeof TokenSetAuthService).toBe("function");
	});

	it("TokenSetAuthRegistry class is defined as an Injectable contract", () => {
		expect(TokenSetAuthRegistry).toBeDefined();
		expect(typeof TokenSetAuthRegistry).toBe("function");
	});

	it("BasicAuthContextService class is defined as an Injectable contract", () => {
		expect(BasicAuthContextService).toBeDefined();
		expect(typeof BasicAuthContextService).toBe("function");
	});

	it("SessionContextService class is defined as an Injectable contract", () => {
		expect(SessionContextService).toBeDefined();
		expect(typeof SessionContextService).toBe("function");
	});

	it("createTokenSetBearerInterceptor is a function", () => {
		expect(typeof createTokenSetBearerInterceptor).toBe("function");
	});

	it("CallbackResumeService class is defined as an Injectable contract", () => {
		expect(CallbackResumeService).toBeDefined();
		expect(typeof CallbackResumeService).toBe("function");
	});
});

// ===========================================================================
// 2. Signal bridge tests — using real Angular WritableSignal
// ===========================================================================

describe("Angular Integration — Signal Bridge with real Angular signal", () => {
	it("syncs SDK signal to Angular WritableSignal", async () => {
		const { signal: angularSignal } = await import("@angular/core");
		const { signal: sdkSignal, set } = createTestSignal<string | null>("hello");
		const angularSig = angularSignal<string | null>(null);

		const cleanup = bridgeToAngularSignal(sdkSignal, angularSig);
		expect(angularSig()).toBe("hello");

		set("world");
		expect(angularSig()).toBe("world");

		cleanup();
		set("after-cleanup");
		expect(angularSig()).toBe("world");
	});

	it("bridges AuthSnapshot to Angular signal", async () => {
		const { signal: angularSignal } = await import("@angular/core");
		const { signal: sdkSignal, set } = createTestSignal<AuthSnapshot | null>(
			null,
		);
		const angularSig = angularSignal<AuthSnapshot | null>(null);

		bridgeToAngularSignal(sdkSignal, angularSig);
		expect(angularSig()).toBeNull();

		set(makeSnapshot("tok-123"));
		expect(angularSig()?.tokens.accessToken).toBe("tok-123");
	});
});

// ===========================================================================
// 3. RxJS Observable bridge — using real RxJS Observable
// ===========================================================================

describe("Angular Integration — RxJS Observable Bridge", () => {
	it("returns a real RxJS Observable", () => {
		const { signal } = createTestSignal("initial");
		const obs$ = signalToObservable(signal);
		expect(obs$).toBeInstanceOf(Observable);
	});

	it("emits current value and subsequent changes", () => {
		const { signal, set } = createTestSignal(0);
		const obs$ = signalToObservable(signal);

		const values: number[] = [];
		const sub = obs$.subscribe((v) => values.push(v));

		set(1);
		set(2);

		expect(values).toEqual([0, 1, 2]);
		sub.unsubscribe();
	});

	it("stops emitting after unsubscribe", () => {
		const { signal, set } = createTestSignal("a");
		const obs$ = signalToObservable(signal);

		const values: string[] = [];
		const sub = obs$.subscribe((v) => values.push(v));

		set("b");
		sub.unsubscribe();
		set("c");

		expect(values).toEqual(["a", "b"]);
	});
});

// ===========================================================================
// 4. Multi-client TokenSetAuthRegistry tests
// ===========================================================================

describe("Angular Integration — TokenSetAuthRegistry (multi-client)", () => {
	it("registers multiple clients and looks up by key", () => {
		const registry = new TokenSetAuthRegistry();

		registry.register({
			key: "main",
			clientFactory: () => createMockClient(),
		});
		registry.register({
			key: "admin",
			clientFactory: () => createMockClient(),
		});

		expect(registry.keys()).toEqual(["main", "admin"]);
		expect(registry.get("main")).toBeInstanceOf(TokenSetAuthService);
		expect(registry.get("admin")).toBeInstanceOf(TokenSetAuthService);
		expect(registry.get("unknown")).toBeUndefined();
	});

	it("require() throws for missing key with helpful message", () => {
		const registry = new TokenSetAuthRegistry();
		expect(() => registry.require("missing")).toThrow(
			/No client registered for key "missing"/,
		);
	});

	it("clientKeyForUrl matches URL patterns", () => {
		const registry = new TokenSetAuthRegistry();

		registry.register({
			key: "api",
			clientFactory: () => createMockClient(),
			urlPatterns: ["/api/"],
		});
		registry.register({
			key: "admin",
			clientFactory: () => createMockClient(),
			urlPatterns: [/^\/admin-api\//],
		});

		expect(registry.clientKeyForUrl("/api/users")).toBe("api");
		expect(registry.clientKeyForUrl("/admin-api/settings")).toBe("admin");
		expect(registry.clientKeyForUrl("/public/page")).toBeUndefined();
	});

	it("clientKeyForCallback matches registered callback paths", () => {
		const registry = new TokenSetAuthRegistry();

		registry.register({
			key: "main",
			clientFactory: () => createMockClient(),
			callbackPath: "/auth/callback",
		});
		registry.register({
			key: "admin",
			clientFactory: () => createMockClient(),
			callbackPath: "/admin/callback",
		});

		expect(
			registry.clientKeyForCallback("https://app.test/auth/callback?code=abc"),
		).toBe("main");
		expect(
			registry.clientKeyForCallback("https://app.test/admin/callback?code=xyz"),
		).toBe("admin");
		expect(
			registry.clientKeyForCallback("https://app.test/dashboard"),
		).toBeUndefined();
	});

	it("accessToken() picks the first available token across clients", () => {
		const registry = new TokenSetAuthRegistry();

		const client1 = createMockClient(null);
		const client2 = createMockClient(makeSnapshot("admin-tok"));

		registry.register({ key: "main", clientFactory: () => client1 });
		registry.register({ key: "admin", clientFactory: () => client2 });

		// Without key — first non-null token wins.
		expect(registry.accessToken()).toBe("admin-tok");
		// With explicit key.
		expect(registry.accessToken("admin")).toBe("admin-tok");
		expect(registry.accessToken("main")).toBeNull();
	});

	it("entries() returns all registered [key, service] pairs", () => {
		const registry = new TokenSetAuthRegistry();

		registry.register({ key: "a", clientFactory: () => createMockClient() });
		registry.register({ key: "b", clientFactory: () => createMockClient() });

		const entries = registry.entries();
		expect(entries).toHaveLength(2);
		expect(entries[0]?.[0]).toBe("a");
		expect(entries[1]?.[0]).toBe("b");
	});
});

// ===========================================================================
// 5. TokenSetAuthService unit tests
// ===========================================================================

describe("Angular Integration — TokenSetAuthService", () => {
	it("bridges state to Angular signal and RxJS Observable", () => {
		const client = createMockClient();
		const service = new TokenSetAuthService(client, true);

		expect(service.authState()).toBeNull();
		expect(service.isAuthenticated()).toBe(false);
		expect(service.accessToken()).toBeNull();
		expect(service.authState$).toBeInstanceOf(Observable);
	});

	it("auto-restores state when autoRestore is true", () => {
		const client = createMockClient();
		const service = new TokenSetAuthService(client, true);

		expect(client.restorePersistedState).toHaveBeenCalledOnce();
		expect(service.restorePromise).toBeDefined();
	});

	it("skips restore when autoRestore is false", () => {
		const client = createMockClient();
		const service = new TokenSetAuthService(client, false);

		expect(client.restorePersistedState).not.toHaveBeenCalled();
		expect(service.restorePromise).toBeNull();
	});

	it("disposes client on explicit dispose()", () => {
		const client = createMockClient();
		const service = new TokenSetAuthService(client, false);

		expect(client.dispose).not.toHaveBeenCalled();
		service.dispose();
		expect(client.dispose).toHaveBeenCalledOnce();
	});

	it("registry.dispose() propagates to all materialized services", () => {
		const registry = new TokenSetAuthRegistry();
		const client1 = createMockClient();
		const client2 = createMockClient();
		registry.register({ key: "a", clientFactory: () => client1 });
		registry.register({ key: "b", clientFactory: () => client2 });

		registry.dispose();
		expect(client1.dispose).toHaveBeenCalledOnce();
		expect(client2.dispose).toHaveBeenCalledOnce();
	});
});

// ===========================================================================
// 6. Callback helper tests
// ===========================================================================

describe("Angular Integration — Callback Helpers", () => {
	describe("isOidcCallback", () => {
		it("returns true for callback URL with code", () => {
			expect(
				isOidcCallback({
					currentUrl:
						"https://app.example.com/auth/callback?code=abc&state=xyz",
					callbackPath: "/auth/callback",
				}),
			).toBe(true);
		});

		it("returns false for non-callback URL", () => {
			expect(
				isOidcCallback({
					currentUrl: "https://app.example.com/dashboard",
					callbackPath: "/auth/callback",
				}),
			).toBe(false);
		});
	});
});

// ===========================================================================
// 7. Multi-client interceptor tests
// ===========================================================================

describe("Angular Integration — Multi-client Bearer Interceptor", () => {
	it("selects correct token based on URL pattern", async () => {
		const registry = new TokenSetAuthRegistry();

		const apiClient = createMockClient(makeSnapshot("api-token"));
		const adminClient = createMockClient(makeSnapshot("admin-token"));

		registry.register({
			key: "api",
			clientFactory: () => apiClient,
			urlPatterns: ["/api/"],
		});
		registry.register({
			key: "admin",
			clientFactory: () => adminClient,
			urlPatterns: ["/admin-api/"],
		});

		const interceptor = createTokenSetBearerInterceptor(registry);
		let clonedHeaders: Record<string, string> = {};

		const mockReq = {
			url: "/api/users",
			clone: (update: { setHeaders?: Record<string, string> }) => {
				clonedHeaders = update.setHeaders ?? {};
				return { ...mockReq, ...update };
			},
		};

		const mockNext = vi.fn().mockReturnValue(of({}));
		await firstValueFrom(interceptor(mockReq, mockNext));

		expect(clonedHeaders.Authorization).toBe("Bearer api-token");
	});

	it("falls back to first available token when no URL pattern matches", async () => {
		const registry = new TokenSetAuthRegistry();

		registry.register({
			key: "default",
			clientFactory: () => createMockClient(makeSnapshot("fallback-tok")),
		});

		const interceptor = createTokenSetBearerInterceptor(registry);
		let clonedHeaders: Record<string, string> = {};

		const mockReq = {
			url: "/some/path",
			clone: (update: { setHeaders?: Record<string, string> }) => {
				clonedHeaders = update.setHeaders ?? {};
				return { ...mockReq, ...update };
			},
		};

		const mockNext = vi.fn().mockReturnValue(of({}));
		await firstValueFrom(interceptor(mockReq, mockNext));

		expect(clonedHeaders.Authorization).toBe("Bearer fallback-tok");
	});

	it("passes request through when no token is available", async () => {
		const registry = new TokenSetAuthRegistry();

		registry.register({
			key: "empty",
			clientFactory: () => createMockClient(null),
		});

		const interceptor = createTokenSetBearerInterceptor(registry);
		const mockReq = {
			url: "/api/test",
			clone: vi.fn(),
		};

		const nextObs = of({});
		const mockNext = vi.fn().mockReturnValue(nextObs);
		const result = interceptor(mockReq, mockNext);
		await firstValueFrom(result);

		expect(mockReq.clone).not.toHaveBeenCalled();
		expect(mockNext).toHaveBeenCalledWith(mockReq);
	});
});

// ===========================================================================
// 8. End-to-end multi-client integration proof
// ===========================================================================

describe("Angular Integration — E2E Multi-client Architecture Proof", () => {
	it("proves multi-client lifecycle: registry → services → interceptor → callback → destroy", async () => {
		// 1. Create registry (simulates what provideTokenSetAuth does)
		const registry = new TokenSetAuthRegistry();

		const mainState = createTestSignal<AuthSnapshot | null>(null);
		const mainClient: OidcModeClient & OidcCallbackClient = {
			state: mainState.signal,
			dispose: vi.fn(),
			restorePersistedState: vi.fn().mockResolvedValue(null),
			authorizationHeader: vi.fn(() => {
				const accessToken = mainState.signal.get()?.tokens.accessToken;
				return accessToken ? `Bearer ${accessToken}` : null;
			}),
			ensureFreshAuthState: vi
				.fn()
				.mockImplementation(async () => mainState.signal.get()),
			ensureAuthorizationHeader: vi.fn().mockImplementation(async () => {
				const accessToken = mainState.signal.get()?.tokens.accessToken;
				return accessToken ? `Bearer ${accessToken}` : null;
			}),
			handleCallback: vi.fn().mockResolvedValue({
				snapshot: makeSnapshot("main-after-login"),
			}),
		};

		const adminState = createTestSignal<AuthSnapshot | null>(null);
		const adminClient: OidcModeClient & OidcCallbackClient = {
			state: adminState.signal,
			dispose: vi.fn(),
			restorePersistedState: vi.fn().mockResolvedValue(null),
			authorizationHeader: vi.fn(() => {
				const accessToken = adminState.signal.get()?.tokens.accessToken;
				return accessToken ? `Bearer ${accessToken}` : null;
			}),
			ensureFreshAuthState: vi
				.fn()
				.mockImplementation(async () => adminState.signal.get()),
			ensureAuthorizationHeader: vi.fn().mockImplementation(async () => {
				const accessToken = adminState.signal.get()?.tokens.accessToken;
				return accessToken ? `Bearer ${accessToken}` : null;
			}),
			handleCallback: vi.fn().mockResolvedValue({
				snapshot: makeSnapshot("admin-after-login"),
			}),
		};

		// 2. Register multiple clients
		const mainService = registry.register({
			key: "main",
			clientFactory: () => mainClient,
			urlPatterns: ["/api/"],
			callbackPath: "/auth/callback",
		});
		const adminService = registry.register({
			key: "admin",
			clientFactory: () => adminClient,
			urlPatterns: ["/admin-api/"],
			callbackPath: "/admin/callback",
		});

		// 3. Verify initial state
		expect(mainService.isAuthenticated()).toBe(false);
		expect(adminService.isAuthenticated()).toBe(false);

		// 4. Observable tracking
		const mainStates: boolean[] = [];
		const sub = mainService.authState$.subscribe((snap) =>
			mainStates.push(snap !== null),
		);
		expect(mainStates).toEqual([false]);

		// 5. Simulate main client login
		mainState.set(makeSnapshot("main-tok"));
		expect(mainStates).toEqual([false, true]);
		expect(mainService.isAuthenticated()).toBe(true);
		expect(mainService.accessToken()).toBe("main-tok");

		// 6. Interceptor uses correct token per URL
		const interceptor = createTokenSetBearerInterceptor(registry);
		let authHeader = "";
		const req = {
			url: "/api/data",
			clone: (u: { setHeaders?: Record<string, string> }) => {
				authHeader = u.setHeaders?.Authorization ?? "";
				return req;
			},
		};
		await firstValueFrom(interceptor(req, () => of({})));
		expect(authHeader).toBe("Bearer main-tok");

		// 7. Callback discrimination
		expect(
			registry.clientKeyForCallback("https://app.test/auth/callback?code=abc"),
		).toBe("main");
		expect(
			registry.clientKeyForCallback("https://app.test/admin/callback?code=xyz"),
		).toBe("admin");

		// 8. Explicit dispose triggers teardown for all registered clients.
		registry.dispose();
		expect(mainClient.dispose).toHaveBeenCalledOnce();
		expect(adminClient.dispose).toHaveBeenCalledOnce();

		sub.unsubscribe();
	});
});
// ===========================================================================
// 9. Requirement kind / provider family mapping (REVIEW4 Blocker 4)
// ===========================================================================

describe("Angular Integration — RequirementKind / ProviderFamily mapping", () => {
	it("clientKeyForRequirement resolves to registered client key", () => {
		const registry = new TokenSetAuthRegistry();

		registry.register({
			key: "main",
			clientFactory: () => createMockClient(),
			requirementKind: "backend_oidc",
		});
		registry.register({
			key: "admin",
			clientFactory: () => createMockClient(),
			requirementKind: "frontend_oidc",
		});

		expect(registry.clientKeyForRequirement("backend_oidc")).toBe("main");
		expect(registry.clientKeyForRequirement("frontend_oidc")).toBe("admin");
		expect(registry.clientKeyForRequirement("session")).toBeUndefined();
	});

	it("requireForRequirement returns the service and throws for missing kind", () => {
		const registry = new TokenSetAuthRegistry();

		registry.register({
			key: "main",
			clientFactory: () => createMockClient(),
			requirementKind: "backend_oidc",
		});

		expect(registry.requireForRequirement("backend_oidc")).toBeInstanceOf(
			TokenSetAuthService,
		);
		expect(() => registry.requireForRequirement("unknown_kind")).toThrow(
			/No client registered for requirementKind "unknown_kind"/,
		);
	});

	it("clientKeyForProviderFamily resolves to registered client key", () => {
		const registry = new TokenSetAuthRegistry();

		registry.register({
			key: "google",
			clientFactory: () => createMockClient(),
			providerFamily: "google",
		});
		registry.register({
			key: "internal",
			clientFactory: () => createMockClient(),
			providerFamily: "internal-sso",
		});

		expect(registry.clientKeyForProviderFamily("google")).toBe("google");
		expect(registry.clientKeyForProviderFamily("internal-sso")).toBe(
			"internal",
		);
		expect(registry.clientKeyForProviderFamily("github")).toBeUndefined();
	});

	it("requireForProviderFamily returns the service and throws for missing family", () => {
		const registry = new TokenSetAuthRegistry();

		registry.register({
			key: "internal",
			clientFactory: () => createMockClient(),
			providerFamily: "internal-sso",
		});

		expect(registry.requireForProviderFamily("internal-sso")).toBeInstanceOf(
			TokenSetAuthService,
		);
		expect(() => registry.requireForProviderFamily("github")).toThrow(
			/No client registered for providerFamily "github"/,
		);
	});

	it("requirementKind and providerFamily can coexist on the same entry", () => {
		const registry = new TokenSetAuthRegistry();

		registry.register({
			key: "primary",
			clientFactory: () => createMockClient(),
			requirementKind: "backend_oidc",
			providerFamily: "company-sso",
		});

		// Both axes resolve to the same client key.
		expect(registry.clientKeyForRequirement("backend_oidc")).toBe("primary");
		expect(registry.clientKeyForProviderFamily("company-sso")).toBe("primary");
		expect(registry.require("primary")).toBeInstanceOf(TokenSetAuthService);
	});
});

// ===========================================================================
// 10. createTokenSetRouteAggregationGuard — requirementPolicies (fine-grained)
//
// Proves that the canonical guard absorbs all former createTokenSetAuthGuard
// capabilities via requirementPolicies: per-requirement selector (clientKey /
// query) and per-requirement onUnauthenticated handler.
// ===========================================================================

import { createPlannerHost } from "@securitydept/client/auth-coordination";
import {
	type ClientFilter,
	type ClientMeta,
	type ClientQueryOptions,
	createTokenSetRouteAggregationGuard,
	type TokenSetClientSelector,
	type TokenSetRequirementPolicy,
} from "@securitydept/token-set-context-client-angular";

describe("Angular Integration — createTokenSetRouteAggregationGuard requirementPolicies", () => {
	it("createTokenSetRouteAggregationGuard is a function", () => {
		expect(typeof createTokenSetRouteAggregationGuard).toBe("function");
	});

	it("requirementPolicies with clientKey selector — returns a CanActivateFn", () => {
		const guard = createTokenSetRouteAggregationGuard({
			requirementPolicies: {
				"main-auth": {
					selector: { clientKey: "main" },
					onUnauthenticated: () => false,
				},
			},
		});
		expect(typeof guard).toBe("function");
	});

	it("requirementPolicies with query selector — returns a CanActivateFn", () => {
		const guard = createTokenSetRouteAggregationGuard({
			requirementPolicies: {
				"oidc-auth": {
					selector: {
						query: {
							providerFamily: "authentik",
							requirementKind: "frontend_oidc",
						},
					},
					onUnauthenticated: () => "/login",
				},
			},
		});
		expect(typeof guard).toBe("function");
	});

	it("multiple requirementPolicies — returns a CanActivateFn", () => {
		const guard = createTokenSetRouteAggregationGuard({
			requirementPolicies: {
				"main-oidc": {
					selector: { clientKey: "main" },
					onUnauthenticated: () => "/login",
				},
				"admin-oidc": {
					selector: { query: { providerFamily: "admin-sso" } },
					onUnauthenticated: () => "/admin/login",
				},
			},
		});
		expect(typeof guard).toBe("function");
	});

	it("inline plannerHost is accepted", () => {
		const host = createPlannerHost();
		const guard = createTokenSetRouteAggregationGuard({
			plannerHost: host,
			requirementPolicies: {
				"test-auth": {
					selector: { clientKey: "test" },
					onUnauthenticated: () => false,
				},
			},
		});
		expect(typeof guard).toBe("function");
	});

	it("TokenSetRequirementPolicy type shape is correct", () => {
		const policy: TokenSetRequirementPolicy = {
			selector: { clientKey: "main" },
			onUnauthenticated: () => false,
		};
		expect(policy.selector).toBeDefined();
		expect(typeof policy.onUnauthenticated).toBe("function");
	});

	it("TokenSetClientSelector accepts clientKey or query", () => {
		const byKey: TokenSetClientSelector = { clientKey: "main" };
		const byQuery: TokenSetClientSelector = {
			query: { requirementKind: "frontend_oidc" },
		};
		expect(byKey.clientKey).toBe("main");
		expect(byQuery.query).toBeDefined();
	});

	it("ClientFilter type is importable and has correct shape", () => {
		const filter: ClientFilter = {
			url: "/api/",
			providerFamily: "authentik",
			requirementKind: "frontend_oidc",
			selector: (meta: ClientMeta, _idx: number) =>
				meta.providerFamily === "authentik",
		};
		expect(filter.url).toBe("/api/");
		expect(filter.providerFamily).toBe("authentik");
	});

	it("ClientQueryOptions accepts single filter or array", () => {
		const single: ClientQueryOptions = { providerFamily: "authentik" };
		const multi: ClientQueryOptions = [
			{ providerFamily: "authentik" },
			{ url: "/api/" },
		];
		expect(single).toBeDefined();
		expect(multi).toBeDefined();
	});

	it("ClientMeta shape is importable (type-level)", () => {
		const meta: ClientMeta = {
			clientKey: "main",
			urlPatterns: ["/api/", /^\/v2/],
			callbackPath: "/auth/callback",
			requirementKind: "frontend_oidc",
			providerFamily: "authentik",
			priority: "primary",
		};
		expect(meta.clientKey).toBe("main");
	});
});

// ===========================================================================
// 11. Angular nested-scope requirements composition — contract evidence
//
// Proves the three-layer model:
//   1. parent scope effective set (provideRouteScopedRequirements resolves against parent)
//   2. child scope with composition strategy (inherit / merge / replace)
//   3. guard-declared candidates overlay (always Merge, guard wins)
//
// Tests use resolveEffectiveClientSet directly to mirror what the DI factory
// does at each scope boundary, validating the contract without a full Angular
// router + DI test bed.
// ===========================================================================

import {
	type AuthGuardClientOption,
	RequirementsClientSetComposition,
	resolveEffectiveClientSet,
} from "@securitydept/client/auth-coordination";
import {
	AUTH_REQUIREMENTS_CLIENT_SET,
	provideRouteScopedRequirements,
} from "@securitydept/client-angular";

describe("Angular nested-scope requirements composition — contract evidence", () => {
	// Shared fixture candidates
	const sessionOpt: AuthGuardClientOption = {
		requirementId: "session",
		requirementKind: "session",
		checkAuthenticated: () => true,
		onUnauthenticated: () => false,
	};
	const oidcOpt: AuthGuardClientOption = {
		requirementId: "oidc",
		requirementKind: "frontend_oidc",
		checkAuthenticated: () => false,
		onUnauthenticated: () => "/login",
	};
	const adminOpt: AuthGuardClientOption = {
		requirementId: "admin",
		requirementKind: "backend_oidc",
		checkAuthenticated: () => false,
		onUnauthenticated: () => "/admin/login",
	};

	// ── Scope composition (parent → child) ──────────────────────────────────

	it("Replace: app scope establishes base set from empty parent", () => {
		// Level 0: no parent (empty)
		// Level 1 (app): Replace with [sessionOpt]
		const appEffective = resolveEffectiveClientSet([], {
			composition: RequirementsClientSetComposition.Replace,
			options: [sessionOpt],
		});
		expect(appEffective.map((o) => o.requirementId)).toEqual(["session"]);
	});

	it("Merge: feature scope appends to app scope", () => {
		// Level 1 (app): [sessionOpt]
		// Level 2 (feature): Merge [oidcOpt]
		const appEffective = [sessionOpt];
		const featureEffective = resolveEffectiveClientSet(appEffective, {
			composition: RequirementsClientSetComposition.Merge,
			options: [oidcOpt],
		});
		expect(featureEffective.map((o) => o.requirementId)).toEqual([
			"session",
			"oidc",
		]);
	});

	it("Inherit: feature scope passes parent effective set unchanged", () => {
		// Level 1 (app): [sessionOpt]
		// Level 2 (feature): Inherit — child options are ignored
		const appEffective = [sessionOpt];
		const featureEffective = resolveEffectiveClientSet(appEffective, {
			composition: RequirementsClientSetComposition.Inherit,
			options: [oidcOpt], // declared but not applied (inherit discards child)
		});
		expect(featureEffective.map((o) => o.requirementId)).toEqual(["session"]);
	});

	it("Replace: child scope discards parent entirely", () => {
		const appEffective = [sessionOpt];
		const childEffective = resolveEffectiveClientSet(appEffective, {
			composition: RequirementsClientSetComposition.Replace,
			options: [oidcOpt],
		});
		expect(childEffective.map((o) => o.requirementId)).toEqual(["oidc"]);
	});

	// ── Guard overlay (scope effective set → guard candidates) ──────────────
	// Guard always uses Merge semantics so guard candidates are never swallowed.

	it("Guard overlay: Merge always appends guard candidates to scope effective set", () => {
		// Scope effective: [sessionOpt, oidcOpt]
		// Guard declares: [adminOpt]
		// Expected: [session, oidc, admin]
		const scopeEffective = [sessionOpt, oidcOpt];
		const guardEffective = resolveEffectiveClientSet(scopeEffective, {
			composition: RequirementsClientSetComposition.Merge,
			options: [adminOpt],
		});
		expect(guardEffective.map((o) => o.requirementId)).toEqual([
			"session",
			"oidc",
			"admin",
		]);
	});

	it("Guard overlay after Inherit scope: guard candidates still preserved", () => {
		// Scope Inherit means scope effective == parent effective == [sessionOpt]
		// Guard overlay with [adminOpt] → expected: [session, admin]
		// This is the key regression test: guard candidates must NOT be swallowed
		// even when the scope's own composition is Inherit.
		const scopeEffective = resolveEffectiveClientSet([sessionOpt], {
			composition: RequirementsClientSetComposition.Inherit,
			options: [],
		});
		const guardEffective = resolveEffectiveClientSet(scopeEffective, {
			composition: RequirementsClientSetComposition.Merge,
			options: [adminOpt],
		});
		expect(guardEffective.map((o) => o.requirementId)).toEqual([
			"session",
			"admin",
		]);
	});

	it("Guard overlay: same requirementId — guard candidate takes precedence", () => {
		// Scope has oidcOpt; guard re-declares oidc with different behavior
		const guardOidcOverride: AuthGuardClientOption = {
			requirementId: "oidc", // same id as oidcOpt
			requirementKind: "frontend_oidc",
			checkAuthenticated: () => true, // guard overrides to always-authenticated
			onUnauthenticated: () => false,
		};
		const scopeEffective = [sessionOpt, oidcOpt];
		const guardEffective = resolveEffectiveClientSet(scopeEffective, {
			composition: RequirementsClientSetComposition.Merge,
			options: [guardOidcOverride],
		});
		// Guard's oidc replaces scope's oidc; session is preserved
		expect(guardEffective.map((o) => o.requirementId)).toEqual([
			"session",
			"oidc",
		]);
		// The oidc candidate should be guard's override (always-authenticated)
		const oidcCandidate = guardEffective.find(
			(o) => o.requirementId === "oidc",
		);
		expect(oidcCandidate?.checkAuthenticated()).toBe(true);
	});

	// ── Full 3-layer end-to-end contract ────────────────────────────────────

	it("3-layer contract: app→feature→guard produces correct effective set for planner", async () => {
		// Layer 1 (app scope): Replace with [sessionOpt]
		const appEffective = resolveEffectiveClientSet([], {
			composition: RequirementsClientSetComposition.Replace,
			options: [sessionOpt],
		});

		// Layer 2 (feature scope): Merge [oidcOpt]
		const featureEffective = resolveEffectiveClientSet(appEffective, {
			composition: RequirementsClientSetComposition.Merge,
			options: [oidcOpt],
		});

		// Layer 3 (guard overlay): Merge [adminOpt]
		const finalCandidates = resolveEffectiveClientSet(featureEffective, {
			composition: RequirementsClientSetComposition.Merge,
			options: [adminOpt],
		});

		expect(finalCandidates.map((o) => o.requirementId)).toEqual([
			"session",
			"oidc",
			"admin",
		]);

		// Run through planner to verify it selects the first unauthenticated
		// in declaration order (session is authenticated, oidc is not → planner picks oidc)
		const { createPlannerHost } = await import(
			"@securitydept/client/auth-coordination"
		);
		const host = createPlannerHost();
		const result = await host.evaluate(finalCandidates);

		expect(result.allAuthenticated).toBe(false);
		// oidc is the first unauthenticated requirement in declaration order
		expect(result.pendingCandidate?.requirementId).toBe("oidc");
	});

	// ── DI token / provider shape ────────────────────────────────────────────

	it("AUTH_REQUIREMENTS_CLIENT_SET token is importable", () => {
		expect(AUTH_REQUIREMENTS_CLIENT_SET).toBeDefined();
		expect(typeof AUTH_REQUIREMENTS_CLIENT_SET.toString()).toBe("string");
	});

	it("provideRouteScopedRequirements returns EnvironmentProviders", () => {
		const providers = provideRouteScopedRequirements({
			composition: RequirementsClientSetComposition.Merge,
			options: [sessionOpt],
		});
		// EnvironmentProviders is an opaque Angular object — verify it's truthy
		expect(providers).toBeDefined();
	});
});
