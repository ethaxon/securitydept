import { HttpClient, HttpRequest, HttpResponse } from "@angular/common/http";
import {
	createEnvironmentInjector,
	Injector,
	runInInjectionContext,
} from "@angular/core";
import { Router } from "@angular/router";
import {
	createEventSubject,
	createFoundationEnvironment,
	createSignal,
	ResourceStatus,
	resourceFromSnapshots,
} from "@securitydept/client";
import { provideEnvironment } from "@securitydept/client-angular";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import {
	TokenSetClientInitializationMode,
	type TokenSetClientRegistryEntry,
} from "@securitydept/token-set-context-client/registry";
import {
	createTokenSetClientRegistryAuthorizationInterceptor,
	provideTokenSetClientRegistry,
	TOKEN_SET_CLIENT_REGISTRY,
	TOKEN_SET_CLIENT_REGISTRY_AUTHORIZATION_FOR_REQUEST,
	TokenSetClientRegistryService,
} from "@securitydept/token-set-context-client-angular";
import { firstValueFrom, of } from "rxjs";
import { describe, expect, it, vi } from "vitest";

function createOidcClient(
	name: string,
	authorizationHeader: string,
	disposeSpy: () => void = vi.fn<() => void>(() => undefined),
): BaseOidcModeClient {
	const authSnapshot = createSignal({
		status: ResourceStatus.Resolved,
		value: null,
	} as const);
	const authResource = resourceFromSnapshots(() => authSnapshot.get());
	const isAuthenticatedSnapshot = createSignal({
		status: ResourceStatus.Resolved,
		value: true,
	} as const);
	const isAuthenticated = resourceFromSnapshots(() =>
		isAuthenticatedSnapshot.get(),
	);
	const authorizationSnapshot = createSignal({
		status: ResourceStatus.Resolved,
		value: authorizationHeader as string | undefined,
	} as const);
	const authorizationHeaderValue = resourceFromSnapshots(() =>
		authorizationSnapshot.get(),
	);
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
		dispose: disposeSpy,
		loginWithRedirect: vi.fn(async () => undefined),
		loginWithPopup: vi.fn(async () => ({
			snapshot: { tokens: { accessToken: `${name}-at` }, metadata: {} },
		})),
	} as unknown as BaseOidcModeClient;
}

function createEntry(
	clientKey: string,
	clientFactory: () => BaseOidcModeClient | Promise<BaseOidcModeClient>,
	meta: Partial<TokenSetClientRegistryEntry<BaseOidcModeClient>["meta"]> = {},
): TokenSetClientRegistryEntry<BaseOidcModeClient> {
	return {
		clientFactory,
		meta: {
			clientKey,
			urlPatterns: [],
			callbackUrl: undefined,
			requirementKind: undefined,
			providerFamily: undefined,
			initialization: TokenSetClientInitializationMode.Lazy,
			...meta,
		},
	};
}

function createRegistryInjector(
	clients: readonly TokenSetClientRegistryEntry<BaseOidcModeClient>[] = [],
) {
	return createEnvironmentInjector(
		[
			...provideAngularEnvironmentDeps(),
			provideEnvironment({
				createBaseEnvironment: createFoundationEnvironment,
			}),
			...provideTokenSetClientRegistry({ clients }),
		],
		Injector.NULL as never,
	);
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

describe("TokenSetClientRegistryService", () => {
	it("passes client resource initialization options through to the core registry", async () => {
		const factory = vi.fn(() =>
			createOidcClient("workspace", "Bearer workspace"),
		);
		const injector = createRegistryInjector([
			createEntry("workspace", factory, {
				urlPatterns: ["https://api.example.com"],
			}),
		]);

		try {
			const registry = injector.get(TokenSetClientRegistryService);
			const passiveSignal = registry.clientResourceFor("workspace", {
				initialize: false,
			});
			expect(factory).not.toHaveBeenCalled();
			expect(passiveSignal.hasValue()).toBe(false);

			const activeSignal = registry.clientResourceFor("workspace");
			await expect(activeSignal.whenValue()).resolves.toMatchObject({
				authorizationHeaderValue: expect.anything(),
			});
			expect(factory).toHaveBeenCalledTimes(1);
		} finally {
			injector.destroy();
		}
	});

	it("uses core registry entries directly for lifecycle and query lookup", async () => {
		const firstDispose = vi.fn();
		const secondDispose = vi.fn();
		const createdClients = [
			createOidcClient("first", "Bearer first", firstDispose),
			createOidcClient("second", "Bearer second", secondDispose),
		];
		const factory = vi
			.fn<() => BaseOidcModeClient>()
			.mockReturnValueOnce(createdClients[0])
			.mockReturnValueOnce(createdClients[1]);
		const injector = createRegistryInjector([
			createEntry("workspace", factory, {
				urlPatterns: ["https://api.example.com"],
				requirementKind: "workspace_oidc",
				providerFamily: "internal",
			}),
		]);

		try {
			const registry = injector.get(TokenSetClientRegistryService);
			expect(registry.has("workspace")).toBe(true);
			expect(registry.entries.get()).toMatchObject([
				{
					meta: { clientKey: "workspace" },
					status: ResourceStatus.Idle,
				},
			]);

			const firstRecord = await registry.clientRecordFor("workspace", {
				initialize: true,
			});
			expect(firstRecord.client.authorizationHeaderValue.value.get()).toBe(
				"Bearer first",
			);
			expect(registry.entries.get()).toMatchObject([
				{
					meta: { clientKey: "workspace" },
					status: ResourceStatus.Resolved,
				},
			]);

			expect(registry.unregister("workspace")).toBe(true);
			expect(firstDispose).toHaveBeenCalledTimes(1);
			expect(registry.has("workspace")).toBe(false);
			registry.register(
				createEntry("workspace", factory, {
					urlPatterns: ["https://api.example.com"],
					requirementKind: "workspace_oidc",
					providerFamily: "internal",
				}),
			);
			expect(
				[
					...registry.clientRecordGenForQuery({
						requirementKind: "workspace_oidc",
					}),
				].map((record) => record.get().meta.clientKey),
			).toEqual(["workspace"]);

			const secondRecord = await registry.clientRecordFor("workspace", {
				initialize: true,
			});
			expect(secondRecord.client).not.toBe(firstRecord.client);
			expect(secondRecord.client.authorizationHeaderValue.value.get()).toBe(
				"Bearer second",
			);
			expect(factory).toHaveBeenCalledTimes(2);

			expect(registry.unregister("workspace")).toBe(true);
			expect(secondDispose).toHaveBeenCalledTimes(1);
			expect(registry.unregister("workspace")).toBe(false);
			expect(registry.has("workspace")).toBe(false);
			expect(registry.entries.get()).toEqual([]);
		} finally {
			injector.destroy();
		}
	});

	it("provides the core registry through the public injection token", () => {
		const injector = createRegistryInjector();

		try {
			const service = injector.get(TokenSetClientRegistryService);
			const tokenValue = runInInjectionContext(injector, () =>
				injector.get(TOKEN_SET_CLIENT_REGISTRY),
			);

			expect(tokenValue).toBe(service);
		} finally {
			injector.destroy();
		}
	});

	it("client registry authorization interceptor does not use a stale service after unregister()", async () => {
		const injector = createRegistryInjector([
			createEntry(
				"workspace",
				() => createOidcClient("workspace", "Bearer live"),
				{
					urlPatterns: ["https://api.example.com"],
				},
			),
		]);

		try {
			const registry = injector.get(TokenSetClientRegistryService);
			const interceptor = createTokenSetClientRegistryAuthorizationInterceptor({
				registry,
			});
			const next = vi.fn((_request: HttpRequest<unknown>) =>
				of(new HttpResponse({ status: 204 })),
			);
			const originalRequest = new HttpRequest(
				"GET",
				"https://api.example.com/data",
			);

			await firstValueFrom(interceptor(originalRequest, next));
			const authorized = next.mock.calls[0]?.[0];
			expect(authorized).toBeInstanceOf(HttpRequest);
			expect(authorized?.headers.get("Authorization")).toBe("Bearer live");

			registry.unregister("workspace");
			next.mockClear();

			const staleRequest = new HttpRequest(
				"GET",
				"https://api.example.com/data",
			);
			await firstValueFrom(interceptor(staleRequest, next));
			expect(next).toHaveBeenCalledWith(staleRequest);
		} finally {
			injector.destroy();
		}
	});

	it("client registry authorization interceptor supports injected custom request authorization", async () => {
		const authorizationForRequest = vi.fn(
			async (
				receivedRegistry: TokenSetClientRegistryService,
				request: { url: string },
			) => {
				expect(receivedRegistry).toBeInstanceOf(TokenSetClientRegistryService);
				return request.url.endsWith("/internal") ? "Bearer custom" : null;
			},
		);
		const injector = createEnvironmentInjector(
			[
				...provideAngularEnvironmentDeps(),
				provideEnvironment({
					createBaseEnvironment: createFoundationEnvironment,
				}),
				...provideTokenSetClientRegistry({ clients: [] }),
				{
					provide: TOKEN_SET_CLIENT_REGISTRY_AUTHORIZATION_FOR_REQUEST,
					useValue: authorizationForRequest,
				},
			],
			Injector.NULL as never,
		);

		try {
			const interceptor =
				createTokenSetClientRegistryAuthorizationInterceptor();
			const next = vi.fn((_request: HttpRequest<unknown>) =>
				of(new HttpResponse({ status: 204 })),
			);
			const request = new HttpRequest(
				"GET",
				"https://api.example.com/internal",
			);

			await firstValueFrom(
				runInInjectionContext(injector, () => interceptor(request, next)),
			);
			const response = next.mock.calls[0]?.[0];
			expect(response).toBeInstanceOf(HttpRequest);
			expect(response?.headers.get("Authorization")).toBe("Bearer custom");
			expect(authorizationForRequest).toHaveBeenCalledTimes(1);
		} finally {
			injector.destroy();
		}
	});
});
