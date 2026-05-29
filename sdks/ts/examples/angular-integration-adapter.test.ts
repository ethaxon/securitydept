import { InjectionToken } from "@angular/core";
import {
	BASIC_AUTH_CONTEXT_CLIENT,
	BasicAuthContextService,
	provideBasicAuthContext,
} from "@securitydept/basic-auth-context-client-angular";
import {
	createEventSubject,
	createFoundationEnvironment,
	createRootSpan,
	createSignal,
	createTracing,
	type ExternalTransportTrait,
	type ReadableReplaySignalTrait,
	type ReadableSignalTrait,
	SYMBOL_DISPOSE,
} from "@securitydept/client";
import { signalToObservable } from "@securitydept/client/rx";
import { provideEnvironment, toNgSignal } from "@securitydept/client-angular";
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
	provideTokenSetAuth,
	TOKEN_SET_AUTH_REGISTRY,
	type TokenSetAngularClient,
	TokenSetAuthRegistry,
} from "@securitydept/token-set-context-client-angular";
import { firstValueFrom, Observable, of } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { createTestTokenSetReactiveFields } from "./test-token-set-client";

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
	const signal = createSignal(initial);
	return {
		signal,
		set(newValue: T) {
			signal.set(newValue);
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

interface ExampleCallbackClient {
	handleCallback(currentUrl: string): Promise<{
		snapshot: AuthSnapshot | null;
		postAuthRedirectUri?: string;
	}>;
}

type ExampleClient = TokenSetAngularClient & ExampleCallbackClient;

function createMockClient(
	initialState: AuthSnapshot | null = null,
): ExampleClient & { _stateCtrl: ReturnType<typeof createTestSignal> } {
	const stateCtrl = createTestSignal<AuthSnapshot | null>(initialState);
	const reactive = createTestTokenSetReactiveFields(initialState);
	return {
		...reactive.fields,
		authEvents: createEventSubject(),
		addWorkflowSource: vi.fn(() => ({ unsubscribe: vi.fn() })),
		removeWorkflowSource: vi.fn(() => false),
		start: vi.fn(async () => undefined),
		dispose: vi.fn(),
		[SYMBOL_DISPOSE]: vi.fn(),
		restorePersistedState: vi.fn().mockResolvedValue(null),
		loginWithRedirect: vi.fn(async () => undefined),
		loginWithPopup: vi.fn(async () => ({
			snapshot: makeSnapshot("popup-tok"),
		})),
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
		const providers = [
			provideEnvironment({
				environment: createFoundationEnvironment({
					transport: {
						async execute() {
							throw new Error("Unexpected transport call.");
						},
					},
				}),
			}),
			...provideBasicAuthContext({
				config: { baseUrl: "/api", zones: [{ zonePrefix: "/basic" }] },
			}),
		];
		expect(Array.isArray(providers)).toBe(true);
		expect(providers.length).toBeGreaterThanOrEqual(2);
	});

	it("exports SESSION_CONTEXT_CLIENT InjectionToken", () => {
		expect(SESSION_CONTEXT_CLIENT).toBeInstanceOf(InjectionToken);
	});

	it("provideSessionContext returns Angular Provider array", () => {
		const providers = [
			provideEnvironment({
				environment: createFoundationEnvironment({
					transport: {
						execute: vi.fn(async () => ({
							status: 200,
							headers: {},
							body: null,
						})),
					} satisfies ExternalTransportTrait,
					span: createRootSpan(),
					tracing: createTracing(),
				}),
			}),
			...provideSessionContext({
				config: { baseUrl: "/api" },
			}),
		];
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
// 2. Signal interop tests — using Angular toSignal
// ===========================================================================

describe("Angular Integration — Signal interop with Angular toSignal", () => {
	it("syncs SDK signal to Angular Signal", async () => {
		const { signal: sdkSignal, set } = createTestSignal<string | null>("hello");
		const angularSig = toNgSignal(sdkSignal, {
			initialValue: sdkSignal.get(),
			manualCleanup: true,
		});

		expect(angularSig()).toBe("hello");

		set("world");
		expect(angularSig()).toBe("world");
	});

	it("bridges AuthSnapshot to Angular signal", async () => {
		const { signal: sdkSignal, set } = createTestSignal<AuthSnapshot | null>(
			null,
		);
		const angularSig = toNgSignal(sdkSignal, {
			initialValue: sdkSignal.get(),
			manualCleanup: true,
		});

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
		const sub = obs$.subscribe((value: number) => values.push(value));

		set(1);
		set(2);

		expect(values).toEqual([0, 1, 2]);
		sub.unsubscribe();
	});

	it("stops emitting after unsubscribe", () => {
		const { signal, set } = createTestSignal("a");
		const obs$ = signalToObservable(signal);

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

		await expect(registry.initialize("main")).resolves.toBe(mainClient);
		await expect(registry.initialize("admin")).resolves.toBe(adminClient);
		await expect(registry.initialize("unknown")).rejects.toThrow(
			/No client registered for key "unknown"/,
		);
	});

	it("initialize() throws for missing key with helpful message", async () => {
		const registry = new TokenSetAuthRegistry();
		await expect(registry.initialize("missing")).rejects.toThrow(
			/No client registered for key "missing"/,
		);
	});

	it("clientRecordForQuery matches URL patterns", () => {
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

		expect(
			registry.clientRecordForQuery({ url: "/api/users" })?.get().meta
				.clientKey,
		).toBe("api");
		expect(
			registry.clientRecordForQuery({ url: "/admin-api/settings" })?.get().meta
				.clientKey,
		).toBe("admin");
		expect(
			registry.clientRecordForQuery({ url: "/public/page" }),
		).toBeUndefined();
	});

	it("clientRecordForQuery matches registered callback paths", () => {
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
			registry
				.clientRecordForQuery({
					callbackUrl: "https://app.test/auth/callback?code=abc",
				})
				?.get().meta.clientKey,
		).toBe("main");
		expect(
			registry
				.clientRecordForQuery({
					callbackUrl: "https://app.test/admin/callback?code=xyz",
				})
				?.get().meta.clientKey,
		).toBe("admin");
		expect(
			registry.clientRecordForQuery({
				callbackUrl: "https://app.test/dashboard",
			}),
		).toBeUndefined();
	});

	it("reads explicit ready clients through replay signals", async () => {
		const registry = new TokenSetAuthRegistry();

		const client1 = createMockClient(null);
		const client2 = createMockClient(makeSnapshot("admin-tok"));

		registry.register({
			key: "main",
			clientFactory: () => client1,
		});
		registry.register({
			key: "admin",
			clientFactory: () => client2,
		});

		await expect(
			(await registry.initialize("admin")).authSnapshot.whenValue(),
		).resolves.toMatchObject({
			tokens: { accessToken: "admin-tok" },
		});
		await expect(
			(await registry.initialize("main")).authSnapshot.whenValue(),
		).resolves.toBeNull();
	});

	it("entries exposes all ready client records", async () => {
		const registry = new TokenSetAuthRegistry();

		registry.register({
			key: "a",
			clientFactory: () => createMockClient(),
		});
		registry.register({
			key: "b",
			clientFactory: () => createMockClient(),
		});

		await registry.initialize("a");
		await registry.initialize("b");
		expect(registry.entries.get()).toMatchObject([
			{ key: "a", status: "ready" },
			{ key: "b", status: "ready" },
		]);
	});

	it("does not patch registry-managed clients with page-resume trigger sources", async () => {
		await withMockBrowserLifecycleTargets(
			async ({ documentTarget, windowTarget }) => {
				const registry = new TokenSetAuthRegistry();
				const client = createMockClient(makeSnapshot("main-token"));

				registry.register({
					key: "main",
					clientFactory: () => client,
				});
				await registry.initialize("main");

				expect(client.addWorkflowSource).not.toHaveBeenCalled();
				expect(documentTarget.addEventListener).not.toHaveBeenCalled();
				expect(windowTarget.addEventListener).not.toHaveBeenCalled();
				registry.dispose();
			},
		);
	});

	it("allows registry-managed clients to opt out of page-resume workflow triggers", () => {
		withMockBrowserLifecycleTargets(({ documentTarget, windowTarget }) => {
			const registry = new TokenSetAuthRegistry();
			const client = createMockClient(makeSnapshot("main-token"));

			registry.register({
				key: "main",
				clientFactory: () => client,
			});

			expect(client.addWorkflowSource).not.toHaveBeenCalled();
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
		registry.register({
			key: "a",
			clientFactory: () => client1,
		});
		registry.register({
			key: "b",
			clientFactory: () => client2,
		});
		await registry.initialize("a");
		await registry.initialize("b");

		registry.dispose();
		expect(dispose1).toHaveBeenCalledOnce();
		expect(dispose2).toHaveBeenCalledOnce();
	});
});

// ===========================================================================
// 6. Callback helper tests
// ===========================================================================

describe("Angular Integration — Callback Helpers", () => {
	describe("matchesCallbackPath", () => {
		it("returns true for callback URL with code", () => {
			expect(
				matchesCallbackPath({
					currentUrl:
						"https://app.example.com/auth/callback?code=abc&state=xyz",
					callbackPath: "/auth/callback",
				}),
			).toBe(true);
		});

		it("returns false for non-callback URL", () => {
			expect(
				matchesCallbackPath({
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
		const mainClient: ExampleClient = {
			...mainReactive.fields,
			authEvents: createEventSubject(),
			addWorkflowSource: vi.fn(() => ({ unsubscribe: vi.fn() })),
			removeWorkflowSource: vi.fn(() => false),
			start: vi.fn(async () => undefined),
			dispose: vi.fn(),
			[SYMBOL_DISPOSE]: vi.fn(),
			restorePersistedState: vi.fn().mockResolvedValue(null),
			loginWithRedirect: vi.fn(async () => undefined),
			loginWithPopup: vi.fn(async () => ({
				snapshot: makeSnapshot("main-after-login"),
			})),
			handleCallback: vi.fn().mockResolvedValue({
				snapshot: makeSnapshot("main-after-login"),
			}),
		};

		const adminReactive = createTestTokenSetReactiveFields(null);
		const adminClient: ExampleClient = {
			...adminReactive.fields,
			authEvents: createEventSubject(),
			addWorkflowSource: vi.fn(() => ({ unsubscribe: vi.fn() })),
			removeWorkflowSource: vi.fn(() => false),
			start: vi.fn(async () => undefined),
			dispose: vi.fn(),
			[SYMBOL_DISPOSE]: vi.fn(),
			restorePersistedState: vi.fn().mockResolvedValue(null),
			loginWithRedirect: vi.fn(async () => undefined),
			loginWithPopup: vi.fn(async () => ({
				snapshot: makeSnapshot("admin-after-login"),
			})),
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
		const mainRegisteredClient = await registry.initialize("main");
		const adminRegisteredClient = await registry.initialize("admin");

		// 3. Verify initial state
		expect(expectReplayValue(mainRegisteredClient.isAuthenticated)).toBe(false);
		expect(expectReplayValue(adminRegisteredClient.isAuthenticated)).toBe(
			false,
		);

		// 4. Observable tracking
		const mainStates: boolean[] = [];
		const sub = signalToObservable(mainRegisteredClient.authSnapshot).subscribe(
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
			registry
				.clientRecordForQuery({
					callbackUrl: "https://app.test/auth/callback?code=abc",
				})
				?.get().meta.clientKey,
		).toBe("main");
		expect(
			registry
				.clientRecordForQuery({
					callbackUrl: "https://app.test/admin/callback?code=xyz",
				})
				?.get().meta.clientKey,
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
	it("clientRecordForQuery resolves requirement kind to registered record", () => {
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

		expect(
			registry.clientRecordForQuery({ requirementKind: "backend_oidc" })?.get()
				.meta.clientKey,
		).toBe("main");
		expect(
			registry.clientRecordForQuery({ requirementKind: "frontend_oidc" })?.get()
				.meta.clientKey,
		).toBe("admin");
		expect(
			registry.clientRecordForQuery({ requirementKind: "session" }),
		).toBeUndefined();
	});

	it("clientRecordForQuery returns the record for a registered kind", () => {
		const registry = new TokenSetAuthRegistry();
		const client = createMockClient();

		registry.register({
			key: "main",
			clientFactory: () => client,
			requirementKind: "backend_oidc",
		});

		expect(
			registry.clientRecordForQuery({ requirementKind: "backend_oidc" })?.get()
				.meta.clientKey,
		).toBe("main");
		expect(
			registry.clientRecordForQuery({ requirementKind: "unknown_kind" }),
		).toBeUndefined();
	});

	it("clientRecordForQuery resolves provider family to registered record", () => {
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

		expect(
			registry.clientRecordForQuery({ providerFamily: "google" })?.get().meta
				.clientKey,
		).toBe("google");
		expect(
			registry.clientRecordForQuery({ providerFamily: "internal-sso" })?.get()
				.meta.clientKey,
		).toBe("internal");
		expect(
			registry.clientRecordForQuery({ providerFamily: "github" }),
		).toBeUndefined();
	});

	it("clientRecordForQuery returns the record for a registered family", () => {
		const registry = new TokenSetAuthRegistry();
		const client = createMockClient();

		registry.register({
			key: "internal",
			clientFactory: () => client,
			providerFamily: "internal-sso",
		});

		expect(
			registry.clientRecordForQuery({ providerFamily: "internal-sso" })?.get()
				.meta.clientKey,
		).toBe("internal");
		expect(
			registry.clientRecordForQuery({ providerFamily: "github" }),
		).toBeUndefined();
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
		expect(
			registry.clientRecordForQuery({ requirementKind: "backend_oidc" })?.get()
				.meta.clientKey,
		).toBe("primary");
		expect(
			registry.clientRecordForQuery({ providerFamily: "company-sso" })?.get()
				.meta.clientKey,
		).toBe("primary");
		await expect(registry.initialize("primary")).resolves.toBe(primaryClient);
	});
});

// ===========================================================================
// 10. Token-set guard + planner host API (fine-grained policies)
//
// Proves the rewritten surface: createTokenSetCanActivate / Child guards and
// provideTokenSetRequirementPlannerHost with per-requirement selector
// (clientKey / query) and per-requirement / per-kind onUnauthenticated handlers.
// ===========================================================================

import {
	type ClientFilter,
	type ClientMeta,
	type ClientQueryOptions,
	createTokenSetCanActivate,
	createTokenSetCanActivateChild,
	provideTokenSetRequirementPlannerHost,
	type TokenSetClientSelector,
	type TokenSetRequirementPolicy,
} from "@securitydept/token-set-context-client-angular";

describe("Angular Integration — token-set guard + planner host API", () => {
	it("createTokenSetCanActivate / Child return guard functions", () => {
		expect(typeof createTokenSetCanActivate()).toBe("function");
		expect(typeof createTokenSetCanActivateChild()).toBe("function");
	});

	it("provideTokenSetRequirementPlannerHost with clientKey selector policy", () => {
		const providers = provideTokenSetRequirementPlannerHost({
			requirementPolicies: {
				"main-auth": {
					selector: { clientKey: "main" },
					onUnauthenticated: () => false,
				},
			},
		});
		expect(providers).toBeDefined();
	});

	it("provideTokenSetRequirementPlannerHost with query selector policy", () => {
		const providers = provideTokenSetRequirementPlannerHost({
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
		expect(providers).toBeDefined();
	});

	it("provideTokenSetRequirementPlannerHost with multiple policies + kind handlers", () => {
		const providers = provideTokenSetRequirementPlannerHost({
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
			requirementHandlers: { frontend_oidc: () => "/login" },
			defaultOnUnauthenticated: () => false,
		});
		expect(providers).toBeDefined();
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
			initialization: "immediate",
		};
		expect(meta.clientKey).toBe("main");
	});
});

// ===========================================================================
// 11. Angular route requirements composition — contract evidence
//
// Proves the route-tree composition model on the rewritten pipeline:
//   - parent segment establishes a base requirement set
//   - child segment composes via inherit / merge / replace
//   - RouteCompositionRequirementPlanner folds pathFromRoot into the effective
//     requirement list the guard evaluates
//
// Tests project real Angular route data through projectAngularRouteSegments and
// assert the folded effective set, validating the contract without a full
// Angular router + DI test bed.
// ===========================================================================

import { type ActivatedRouteSnapshot } from "@angular/router";
import {
	RequirementPlannerHost,
	RequirementsComposition,
	RouteCompositionRequirementPlanner,
} from "@securitydept/client";
import { projectAngularRouteSegments } from "@securitydept/client-angular";
import { matchesCallbackPath } from "@securitydept/token-set-context-client/registry";
import { secureRoute } from "@securitydept/token-set-context-client-angular";

describe("Angular route requirements composition — contract evidence", () => {
	function buildRouteChain(
		routes: Array<{ path?: string; data?: Record<string, unknown> }>,
	): ActivatedRouteSnapshot {
		const snapshots: ActivatedRouteSnapshot[] = routes.map(
			(route) =>
				({
					routeConfig:
						route.path !== undefined
							? { path: route.path, data: route.data }
							: null,
					data: route.data ?? {},
					pathFromRoot: [] as ActivatedRouteSnapshot[],
				}) as unknown as ActivatedRouteSnapshot,
		);
		for (let i = 0; i < snapshots.length; i++) {
			(
				snapshots[i] as unknown as { pathFromRoot: ActivatedRouteSnapshot[] }
			).pathFromRoot = snapshots.slice(0, i + 1);
		}
		const leaf = snapshots[snapshots.length - 1];
		if (!leaf) {
			throw new Error("buildRouteChain requires at least one segment");
		}
		return leaf;
	}

	function foldEffectiveIds(leaf: ActivatedRouteSnapshot): string[] {
		const planner = RouteCompositionRequirementPlanner.fromRootRoute(
			RequirementPlannerHost.fromBehaviour({}),
			projectAngularRouteSegments(leaf),
		);
		return planner.effectiveRequirements.map((requirement) => requirement.id);
	}

	const appRoute = secureRoute("app", {
		requirements: [{ id: "session", kind: "session" }],
	});
	const featureMerge = secureRoute("feature", {
		requirements: [{ id: "oidc", kind: "frontend_oidc" }],
		composition: RequirementsComposition.Merge,
	});
	const featureInherit = secureRoute("feature", {
		requirements: [{ id: "oidc", kind: "frontend_oidc" }],
		composition: RequirementsComposition.Inherit,
	});
	const featureReplace = secureRoute("feature", {
		requirements: [{ id: "oidc", kind: "frontend_oidc" }],
		composition: RequirementsComposition.Replace,
	});

	it("Merge: feature segment appends to the app segment", () => {
		const leaf = buildRouteChain([appRoute, featureMerge]);
		expect(foldEffectiveIds(leaf)).toEqual(["session", "oidc"]);
	});

	it("Inherit: feature segment ignores its own declaration", () => {
		const leaf = buildRouteChain([appRoute, featureInherit]);
		expect(foldEffectiveIds(leaf)).toEqual(["session"]);
	});

	it("Replace: feature segment discards the inherited chain", () => {
		const leaf = buildRouteChain([appRoute, featureReplace]);
		expect(foldEffectiveIds(leaf)).toEqual(["oidc"]);
	});

	it("Merge with same id: later segment overrides earlier declaration order", () => {
		const leaf = buildRouteChain([
			appRoute,
			secureRoute("feature", {
				requirements: [
					{ id: "oidc", kind: "frontend_oidc" },
					{ id: "session", kind: "session" },
				],
				composition: RequirementsComposition.Merge,
			}),
		]);
		// session keeps its original slot; oidc appended once.
		expect(foldEffectiveIds(leaf)).toEqual(["session", "oidc"]);
	});

	it("multi-level merge accumulates the full path chain", () => {
		const leaf = buildRouteChain([
			appRoute,
			secureRoute("admin", {
				requirements: [{ id: "admin", kind: "backend_oidc" }],
			}),
			secureRoute("settings", {
				requirements: [{ id: "settings", kind: "frontend_oidc" }],
			}),
		]);
		expect(foldEffectiveIds(leaf)).toEqual(["session", "admin", "settings"]);
	});

	it("keeps matchesCallbackPath importable for callback discrimination", () => {
		expect(typeof matchesCallbackPath).toBe("function");
	});
});
