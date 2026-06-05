import { HttpClient, HttpRequest, HttpResponse } from "@angular/common/http";
import {
	createEnvironmentInjector,
	InjectionToken,
	Injector,
} from "@angular/core";
import { Router } from "@angular/router";
import {
	BASIC_AUTH_CONTEXT_CLIENT,
	BasicAuthContextService,
	provideBasicAuthContext,
} from "@securitydept/basic-auth-context-client-angular";
import {
	createEventSubject,
	createFoundationEnvironment,
	createSignal,
	type ReadableSignalTrait,
	ResourceStatus,
	resourceFromSnapshots,
} from "@securitydept/client";
import { provideEnvironment, toNgSignal } from "@securitydept/client-angular";
import {
	provideSessionContext,
	SESSION_CONTEXT_CLIENT,
	SessionContextService,
} from "@securitydept/session-context-client-angular";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import {
	TokenSetClientInitializationMode,
	type TokenSetClientRegistryEntry,
} from "@securitydept/token-set-context-client/registry";
import {
	createTokenSetClientRegistryAuthorizationInterceptor,
	provideTokenSetClientRegistry,
	TOKEN_SET_CLIENT_REGISTRY,
	TokenSetClientRegistryService,
} from "@securitydept/token-set-context-client-angular";
import { firstValueFrom, from, Observable, of } from "rxjs";
import { describe, expect, it, vi } from "vitest";

function createTestSignal<T>(initial: T): {
	signal: ReadableSignalTrait<T>;
	set(value: T): void;
} {
	const signal = createSignal(initial);
	return {
		signal,
		set(value) {
			signal.set(value);
		},
	};
}

function createMockClient(
	name: string,
	authorizationHeader = `Bearer ${name}`,
): BaseOidcModeClient {
	const authSnapshot = createSignal({
		status: ResourceStatus.Resolved,
		value: null,
	} as const);
	const authResource = resourceFromSnapshots(() => authSnapshot.get());
	const isAuthenticated = resourceFromSnapshots(() => ({
		status: ResourceStatus.Resolved,
		value: true,
	}));
	const authorizationHeaderValue = resourceFromSnapshots(() => ({
		status: ResourceStatus.Resolved,
		value: authorizationHeader as string | undefined,
	}));
	return {
		id: name,
		authSnapshot,
		authResource,
		isAuthenticated,
		authorizationHeaderValue,
		authOperations: {
			restorePending: createSignal(false),
			refreshPending: createSignal(false),
			clearPending: createSignal(false),
			loginPending: createSignal(false),
		},
		authEvents: createEventSubject(),
		start: vi.fn(async () => undefined),
		dispose: vi.fn(),
		loginWithRedirect: vi.fn(async () => undefined),
		loginWithPopup: vi.fn(async () => ({
			snapshot: { tokens: { accessToken: `${name}-popup` }, metadata: {} },
		})),
	} as unknown as BaseOidcModeClient;
}

function createEntry(
	clientKey: string,
	clientFactory: () => BaseOidcModeClient,
	meta: Partial<TokenSetClientRegistryEntry<BaseOidcModeClient>["meta"]> = {},
): TokenSetClientRegistryEntry<BaseOidcModeClient> {
	return {
		clientFactory,
		meta: {
			clientKey,
			urlPatterns: [],
			callbackPath: undefined,
			requirementKind: undefined,
			providerFamily: undefined,
			initialization: TokenSetClientInitializationMode.Lazy,
			...meta,
		},
	};
}

function createAngularEnvironmentProviders(
	clients: readonly TokenSetClientRegistryEntry<BaseOidcModeClient>[] = [],
) {
	return [
		...provideAngularEnvironmentDeps(),
		provideEnvironment({
			createBaseEnvironment: createFoundationEnvironment,
		}),
		...provideTokenSetClientRegistry({ clients }),
	];
}

function provideAngularEnvironmentDeps() {
	return [
		{
			provide: Router,
			useValue: {
				url: "/",
				navigateByUrl: vi.fn(async () => true),
			},
		},
		{
			provide: HttpClient,
			useValue: {
				request: vi.fn(() => of(new HttpResponse({ status: 200 }))),
			},
		},
	];
}

describe("Angular integration adapter public surface", () => {
	it("exports current token-set registry token and provider factory", () => {
		expect(TOKEN_SET_CLIENT_REGISTRY).toBeInstanceOf(InjectionToken);
		const providers = provideTokenSetClientRegistry({
			clients: [createEntry("main", () => createMockClient("main"))],
		});

		expect(Array.isArray(providers)).toBe(true);
		expect(providers.length).toBeGreaterThanOrEqual(3);
	});

	it("registers core registry entries through Angular DI", async () => {
		const client = createMockClient("main", "Bearer main");
		const injector = createEnvironmentInjector(
			createAngularEnvironmentProviders([
				createEntry("main", () => client, {
					urlPatterns: ["/api/"],
					callbackPath: "/auth/callback",
				}),
			]),
			Injector.NULL as never,
		);

		try {
			const registry = injector.get(TokenSetClientRegistryService);
			expect(injector.get(TOKEN_SET_CLIENT_REGISTRY)).toBe(registry);
			expect(
				registry.clientRecordForQuery({ url: "/api/users" })?.get().meta,
			).toMatchObject({ clientKey: "main" });
			const ready = await registry.initialize("main");
			expect(ready.client).toBe(client);
		} finally {
			injector.destroy();
		}
	});

	it("supports request authorization from the core registry service", async () => {
		const injector = createEnvironmentInjector(
			createAngularEnvironmentProviders([
				createEntry("api", () => createMockClient("api", "Bearer api"), {
					urlPatterns: ["https://api.example.com"],
				}),
			]),
			Injector.NULL as never,
		);

		try {
			const registry = injector.get(TokenSetClientRegistryService);
			const interceptor = createTokenSetClientRegistryAuthorizationInterceptor({
				registry,
			});
			const next = vi.fn((_request: HttpRequest<unknown>) =>
				of(new HttpResponse({ status: 204 })),
			);
			const request = new HttpRequest("GET", "https://api.example.com/data");

			await firstValueFrom(interceptor(request, next));
			const response = next.mock.calls[0]?.[0];
			expect(response).toBeInstanceOf(HttpRequest);
			expect(response?.headers.get("Authorization")).toBe("Bearer api");
		} finally {
			injector.destroy();
		}
	});

	it("keeps basic-auth and session Angular adapters available", () => {
		expect(BASIC_AUTH_CONTEXT_CLIENT).toBeInstanceOf(InjectionToken);
		expect(SESSION_CONTEXT_CLIENT).toBeInstanceOf(InjectionToken);
		expect(BasicAuthContextService).toBeDefined();
		expect(SessionContextService).toBeDefined();
		expect(
			provideBasicAuthContext({
				config: { baseUrl: "/api", zones: [{ zonePrefix: "/basic" }] },
			}),
		).toHaveLength(3);
		expect(provideSessionContext({ config: { baseUrl: "/api" } })).toHaveLength(
			3,
		);
	});

	it("bridges SDK signals to Angular signals and RxJS observables", () => {
		const { signal, set } = createTestSignal("initial");
		const angularSignal = toNgSignal(signal, {
			initialValue: signal.get(),
			manualCleanup: true,
		});
		const observable = from(signal);
		const values: string[] = [];
		const subscription = observable.subscribe((value) => values.push(value));

		expect(observable).toBeInstanceOf(Observable);
		expect(angularSignal()).toBe("initial");
		set("next");
		expect(angularSignal()).toBe("next");
		expect(values).toEqual(["initial", "next"]);
		subscription.unsubscribe();
	});

	it("exposes client replay signals from registry-backed clients", () => {
		createMockClient("main").authorizationHeaderValue.value.get();
	});
});
