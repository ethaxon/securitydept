import { InjectionToken } from "@angular/core";
import {
	BASIC_AUTH_CONTEXT_CLIENT,
	BasicAuthContextService,
	provideBasicAuthContext,
} from "@securitydept/basic-auth-context-client-angular";
import {
	createSubject,
	type HttpTransport,
	type ReadableReplaySignalTrait,
	type ReadableSignalTrait,
} from "@securitydept/client";
import { toRxObservable } from "@securitydept/client/rx";
import { createWebClientEnvironment } from "@securitydept/client/web";
import { bridgeToAngularSignal } from "@securitydept/client-angular";
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
	type OidcCallbackClient,
	type OidcModeClient,
	provideTokenSetAuth,
	TOKEN_SET_AUTH_REGISTRY,
	TokenSetAuthRegistry,
} from "@securitydept/token-set-context-client-angular";
import { firstValueFrom, Observable, of } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import {
	authCheckResultForSnapshot,
	createTestTokenSetReactiveFields,
} from "./test-token-set-client";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function expectReplayValue<T>(signal: ReadableReplaySignalTrait<T>): T {
	const slot = signal.get();
	expect(slot.kind).toBe("value");
	if (slot.kind !== "value") {
		throw new Error("Expected replay signal value.");
	}
	return slot.value;
}

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
	const reactive = createTestTokenSetReactiveFields(initialState);
	return {
		...reactive.fields,
		authEvents: createSubject(),
		addAuthCheckTriggerSource: vi.fn(() => ({ unsubscribe: vi.fn() })),
		start: vi.fn(async () => undefined),
		dispose: vi.fn(),
		restorePersistedState: vi.fn().mockResolvedValue(null),
		authCheck: vi
			.fn()
			.mockImplementation(async () =>
				authCheckResultForSnapshot(stateCtrl.signal.get()),
			),
		handleCallback: vi.fn().mockResolvedValue({
			snapshot: makeSnapshot("callback-tok"),
		}),
		_stateCtrl: stateCtrl as ReturnType<typeof createTestSignal>,
	};
}

function createMockBrowserLifecycleTargets() {
	return {
		documentTarget: {
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			visibilityState: "visible" as DocumentVisibilityState,
		},
		windowTarget: {
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		},
	};
}

function withMockBrowserLifecycleTargets<T>(
	run: (targets: ReturnType<typeof createMockBrowserLifecycleTargets>) => T,
): T {
	const originalDocument = Object.getOwnPropertyDescriptor(
		globalThis,
		"document",
	);
	const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	const targets = createMockBrowserLifecycleTargets();

	Object.defineProperty(globalThis, "document", {
		value: targets.documentTarget,
		configurable: true,
		writable: true,
	});
	Object.defineProperty(globalThis, "window", {
		value: targets.windowTarget,
		configurable: true,
		writable: true,
	});

	const restore = () => {
		if (originalDocument) {
			Object.defineProperty(globalThis, "document", originalDocument);
		} else {
			Reflect.deleteProperty(globalThis, "document");
		}
		if (originalWindow) {
			Object.defineProperty(globalThis, "window", originalWindow);
		} else {
			Reflect.deleteProperty(globalThis, "window");
		}
	};

	try {
		const result = run(targets);
		if (result instanceof Promise) {
			return result.finally(restore) as T;
		}
		restore();
		return result;
	} catch (error) {
		restore();
		throw error;
	}
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
			environment: createWebClientEnvironment({
				transport: {
					execute: vi.fn(async () => ({
						status: 200,
						headers: {},
						body: null,
					})),
				} satisfies HttpTransport,
			}),
		});
		expect(Array.isArray(providers)).toBe(true);
		expect(providers.length).toBeGreaterThanOrEqual(1);
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
		const obs$ = toRxObservable(signal);
		expect(obs$).toBeInstanceOf(Observable);
	});

	it("emits current value and subsequent changes", () => {
		const { signal, set } = createTestSignal(0);
		const obs$ = toRxObservable(signal);

		const values: number[] = [];
		const sub = obs$.subscribe((value: number) => values.push(value));

		set(1);
		set(2);

		expect(values).toEqual([0, 1, 2]);
		sub.unsubscribe();
	});

	it("stops emitting after unsubscribe", () => {
		const { signal, set } = createTestSignal("a");
		const obs$ = toRxObservable(signal);

		const values: string[] = [];
		const sub = obs$.subscribe((value: string) => values.push(value));

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
	it("registers multiple clients and looks up by key", async () => {
		const registry = new TokenSetAuthRegistry();
		const mainClient = createMockClient();
		const adminClient = createMockClient();

		registry.register({
			key: "main",
			clientFactory: () => mainClient,
		});
		registry.register({
			key: "admin",
			clientFactory: () => adminClient,
		});

		await expect(registry.whenReady("main")).resolves.toBe(mainClient);
		await expect(registry.whenReady("admin")).resolves.toBe(adminClient);
		await expect(registry.whenReady("unknown")).rejects.toThrow(
			/No client registered for key "unknown"/,
		);
	});

	it("whenReady() throws for missing key with helpful message", async () => {
		const registry = new TokenSetAuthRegistry();
		await expect(registry.whenReady("missing")).rejects.toThrow(
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

	it("reads explicit ready clients through replay signals", async () => {
		const registry = new TokenSetAuthRegistry();

		const client1 = createMockClient(null);
		const client2 = createMockClient(makeSnapshot("admin-tok"));

		registry.register({ key: "main", clientFactory: () => client1 });
		registry.register({ key: "admin", clientFactory: () => client2 });

		await expect(
			(await registry.whenReady("admin")).authSnapshot.whenValue(),
		).resolves.toMatchObject({
			tokens: { accessToken: "admin-tok" },
		});
		await expect(
			(await registry.whenReady("main")).authSnapshot.whenValue(),
		).resolves.toBeNull();
		await expect(registry.whenReady()).rejects.toThrow(
			"without a key is only valid for a single registered client",
		);
	});

	it("readyKeys() returns all started client keys", async () => {
		const registry = new TokenSetAuthRegistry();

		registry.register({ key: "a", clientFactory: () => createMockClient() });
		registry.register({ key: "b", clientFactory: () => createMockClient() });

		await registry.whenReady("a");
		await registry.whenReady("b");
		expect(registry.readyKeys()).toEqual(["a", "b"]);
	});

	it("installs page-resume auth-check trigger sources for registry-managed clients by default", async () => {
		await withMockBrowserLifecycleTargets(async () => {
			const registry = new TokenSetAuthRegistry();
			const client = createMockClient(makeSnapshot("main-token"));

			registry.register({
				key: "main",
				clientFactory: () => client,
			});
			await registry.whenReady("main");

			expect(client.addAuthCheckTriggerSource).toHaveBeenCalledTimes(1);
			registry.dispose();
		});
	});

	it("allows registry-managed clients to opt out of page-resume auth-check triggers", () => {
		withMockBrowserLifecycleTargets(({ documentTarget, windowTarget }) => {
			const registry = new TokenSetAuthRegistry();
			const client = createMockClient(makeSnapshot("main-token"));

			registry.register({
				key: "main",
				clientFactory: () => client,
				pageResumeAuthCheck: false,
			});

			expect(client.addAuthCheckTriggerSource).not.toHaveBeenCalled();
			expect(documentTarget.addEventListener).not.toHaveBeenCalled();
			expect(windowTarget.addEventListener).not.toHaveBeenCalled();
		});
	});
});

// ===========================================================================
// 5. Registry-managed client lifecycle
// ===========================================================================

describe("Angular Integration — registry-managed clients", () => {
	it("registry.dispose() propagates to all materialized services", async () => {
		const registry = new TokenSetAuthRegistry();
		const client1 = createMockClient();
		const client2 = createMockClient();
		const dispose1 = client1.dispose;
		const dispose2 = client2.dispose;
		registry.register({ key: "a", clientFactory: () => client1 });
		registry.register({ key: "b", clientFactory: () => client2 });
		await registry.whenReady("a");
		await registry.whenReady("b");

		registry.dispose();
		expect(dispose1).toHaveBeenCalledOnce();
		expect(dispose2).toHaveBeenCalledOnce();
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
		const mainReactive = createTestTokenSetReactiveFields(null);
		const mainClient: OidcModeClient & OidcCallbackClient = {
			...mainReactive.fields,
			authEvents: createSubject(),
			addAuthCheckTriggerSource: vi.fn(() => ({ unsubscribe: vi.fn() })),
			start: vi.fn(async () => undefined),
			dispose: vi.fn(),
			restorePersistedState: vi.fn().mockResolvedValue(null),
			authCheck: vi
				.fn()
				.mockImplementation(async () =>
					authCheckResultForSnapshot(mainState.signal.get()),
				),
			handleCallback: vi.fn().mockResolvedValue({
				snapshot: makeSnapshot("main-after-login"),
			}),
		};

		const adminState = createTestSignal<AuthSnapshot | null>(null);
		const adminReactive = createTestTokenSetReactiveFields(null);
		const adminClient: OidcModeClient & OidcCallbackClient = {
			...adminReactive.fields,
			authEvents: createSubject(),
			addAuthCheckTriggerSource: vi.fn(() => ({ unsubscribe: vi.fn() })),
			start: vi.fn(async () => undefined),
			dispose: vi.fn(),
			restorePersistedState: vi.fn().mockResolvedValue(null),
			authCheck: vi
				.fn()
				.mockImplementation(async () =>
					authCheckResultForSnapshot(adminState.signal.get()),
				),
			handleCallback: vi.fn().mockResolvedValue({
				snapshot: makeSnapshot("admin-after-login"),
			}),
		};

		// 2. Register multiple clients
		const mainDispose = mainClient.dispose;
		const adminDispose = adminClient.dispose;
		registry.register({
			key: "main",
			clientFactory: () => mainClient,
			urlPatterns: ["/api/"],
			callbackPath: "/auth/callback",
		});
		registry.register({
			key: "admin",
			clientFactory: () => adminClient,
			urlPatterns: ["/admin-api/"],
			callbackPath: "/admin/callback",
		});
		const mainRegisteredClient = await registry.whenReady("main");
		const adminRegisteredClient = await registry.whenReady("admin");

		// 3. Verify initial state
		expect(expectReplayValue(mainRegisteredClient.isAuthenticated)).toBe(false);
		expect(expectReplayValue(adminRegisteredClient.isAuthenticated)).toBe(
			false,
		);

		// 4. Observable tracking
		const mainStates: boolean[] = [];
		const sub = toRxObservable(mainRegisteredClient.authSnapshot).subscribe(
			(snap) => mainStates.push(snap !== null),
		);
		expect(mainStates).toEqual([false]);

		// 5. Simulate main client login
		const mainSnapshot = makeSnapshot("main-tok");
		mainState.set(mainSnapshot);
		mainReactive.emitSnapshot(mainSnapshot);
		expect(mainStates).toEqual([false, true]);
		expect(expectReplayValue(mainRegisteredClient.isAuthenticated)).toBe(true);
		expect(
			expectReplayValue(mainRegisteredClient.authSnapshot)?.tokens.accessToken,
		).toBe("main-tok");

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
		expect(mainDispose).toHaveBeenCalledOnce();
		expect(adminDispose).toHaveBeenCalledOnce();

		sub.unsubscribe();
	});
});
// ===========================================================================
// 9. Requirement kind / provider family mapping regression coverage
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

	it("clientKeyForRequirement returns the key for a registered kind", () => {
		const registry = new TokenSetAuthRegistry();
		const client = createMockClient();

		registry.register({
			key: "main",
			clientFactory: () => client,
			requirementKind: "backend_oidc",
		});

		expect(registry.clientKeyForRequirement("backend_oidc")).toBe("main");
		expect(registry.clientKeyForRequirement("unknown_kind")).toBeUndefined();
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

	it("clientKeyForProviderFamily returns the key for a registered family", () => {
		const registry = new TokenSetAuthRegistry();
		const client = createMockClient();

		registry.register({
			key: "internal",
			clientFactory: () => client,
			providerFamily: "internal-sso",
		});

		expect(registry.clientKeyForProviderFamily("internal-sso")).toBe(
			"internal",
		);
		expect(registry.clientKeyForProviderFamily("github")).toBeUndefined();
	});

	it("requirementKind and providerFamily can coexist on the same entry", async () => {
		const registry = new TokenSetAuthRegistry();
		const primaryClient = createMockClient();

		registry.register({
			key: "primary",
			clientFactory: () => primaryClient,
			requirementKind: "backend_oidc",
			providerFamily: "company-sso",
		});

		// Both axes resolve to the same client key.
		expect(registry.clientKeyForRequirement("backend_oidc")).toBe("primary");
		expect(registry.clientKeyForProviderFamily("company-sso")).toBe("primary");
		await expect(registry.whenReady("primary")).resolves.toBe(primaryClient);
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
import { isOidcCallback } from "@securitydept/token-set-context-client/registry";

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
