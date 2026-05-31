import {
	createEnvironmentInjector,
	Injector,
	runInInjectionContext,
} from "@angular/core";
import {
	createEventSubject,
	createFoundationEnvironment,
	createReplaySignal,
	createSignal,
} from "@securitydept/client";
import { provideEnvironment } from "@securitydept/client-angular";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import {
	ClientInitializationMode,
	type ClientRegistryEntry,
	ClientRegistryEntryStatus,
} from "@securitydept/token-set-context-client/registry";
import {
	createTokenSetBearerInterceptor,
	provideTokenSetClientRegistry,
	TOKEN_SET_CLIENT_REGISTRY,
	TokenSetClientRegistryService,
} from "@securitydept/token-set-context-client-angular";
import { firstValueFrom, of } from "rxjs";
import { describe, expect, it, vi } from "vitest";

function expectReplayValue<T>(signal: {
	get(): { kind: "empty" } | { kind: "value"; value: T };
}): T {
	const slot = signal.get();
	expect(slot.kind).toBe("value");
	if (slot.kind !== "value") {
		throw new Error("Expected replay signal value.");
	}
	return slot.value;
}

function createOidcClient(
	name: string,
	authorizationHeader: string,
	disposeSpy: () => void = vi.fn<() => void>(() => undefined),
): BaseOidcModeClient {
	const authDetermined = createReplaySignal<true>();
	authDetermined.setValue(true);
	const authSnapshot = createReplaySignal<null>();
	authSnapshot.setValue(null);
	const isAuthenticated = createReplaySignal<boolean>();
	isAuthenticated.setValue(true);
	const authorizationHeaderValue = createReplaySignal<string | undefined>();
	authorizationHeaderValue.setValue(authorizationHeader);
	return {
		id: name,
		authDetermined,
		authSnapshot,
		isAuthenticated,
		authorizationHeaderValue,
		lastAuthError: createSignal<unknown | undefined>(undefined),
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
	meta: Partial<ClientRegistryEntry<BaseOidcModeClient>["meta"]> = {},
): ClientRegistryEntry<BaseOidcModeClient> {
	return {
		clientFactory,
		meta: {
			clientKey,
			urlPatterns: [],
			callbackPath: undefined,
			requirementKind: undefined,
			providerFamily: undefined,
			initialization: ClientInitializationMode.Lazy,
			...meta,
		},
	};
}

function createRegistryInjector(
	clients: readonly ClientRegistryEntry<BaseOidcModeClient>[] = [],
) {
	return createEnvironmentInjector(
		[
			provideEnvironment({
				environment: () => createFoundationEnvironment({}),
			}),
			...provideTokenSetClientRegistry({ clients }),
		],
		Injector.NULL as never,
	);
}

describe("TokenSetClientRegistryService", () => {
	it("passes client signal initialization options through to the core registry", async () => {
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
			const passiveSignal = registry.clientSignalFor("workspace", {
				initialize: false,
			});
			expect(factory).not.toHaveBeenCalled();
			expect(passiveSignal.hasValue()).toBe(false);

			const activeSignal = registry.clientSignalFor("workspace");
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
					status: ClientRegistryEntryStatus.Registered,
				},
			]);

			const firstRecord = await registry.initialize("workspace");
			expect(
				expectReplayValue(firstRecord.client.authorizationHeaderValue),
			).toBe("Bearer first");
			expect(registry.entries.get()).toMatchObject([
				{
					meta: { clientKey: "workspace" },
					status: ClientRegistryEntryStatus.Ready,
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

			const secondRecord = await registry.initialize("workspace");
			expect(secondRecord.client).not.toBe(firstRecord.client);
			expect(
				expectReplayValue(secondRecord.client.authorizationHeaderValue),
			).toBe("Bearer second");
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

	it("interceptor does not use a stale service after unregister()", async () => {
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
			const interceptor = createTokenSetBearerInterceptor(registry, {
				strictUrlMatch: true,
			});
			const next = vi.fn((request: unknown) => of(request));
			const clone = vi.fn(
				(update: { setHeaders?: Record<string, string> }) => ({
					url: "https://api.example.com/data",
					headers: update.setHeaders,
				}),
			);

			const authorized = await firstValueFrom(
				interceptor(
					{
						url: "https://api.example.com/data",
						clone,
					},
					next,
				),
			);
			expect(clone).toHaveBeenCalledWith({
				setHeaders: { Authorization: "Bearer live" },
			});
			expect(authorized).toMatchObject({
				headers: { Authorization: "Bearer live" },
			});

			registry.unregister("workspace");
			clone.mockClear();
			next.mockClear();

			const originalRequest = {
				url: "https://api.example.com/data",
				clone,
			};
			const result = await firstValueFrom(interceptor(originalRequest, next));
			expect(clone).not.toHaveBeenCalled();
			expect(next).toHaveBeenCalledWith(originalRequest);
			expect(result).toBe(originalRequest);
		} finally {
			injector.destroy();
		}
	});
});
