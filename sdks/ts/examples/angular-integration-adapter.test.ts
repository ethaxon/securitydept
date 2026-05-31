import {
	createEnvironmentInjector,
	InjectionToken,
	Injector,
} from "@angular/core";
import {
	BASIC_AUTH_CONTEXT_CLIENT,
	BasicAuthContextService,
	provideBasicAuthContext,
} from "@securitydept/basic-auth-context-client-angular";
import {
	createEventSubject,
	createFoundationEnvironment,
	createReplaySignal,
	createSignal,
	type ReadableReplaySignalTrait,
	type ReadableSignalTrait,
} from "@securitydept/client";
import { signalToObservable } from "@securitydept/client/rx";
import { provideEnvironment, toNgSignal } from "@securitydept/client-angular";
import {
	provideSessionContext,
	SESSION_CONTEXT_CLIENT,
	SessionContextService,
} from "@securitydept/session-context-client-angular";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import {
	ClientInitializationMode,
	type ClientRegistryEntry,
} from "@securitydept/token-set-context-client/registry";
import {
	createTokenSetBearerInterceptor,
	provideTokenSetClientRegistry,
	TOKEN_SET_CLIENT_REGISTRY,
	TokenSetClientRegistryService,
} from "@securitydept/token-set-context-client-angular";
import { firstValueFrom, Observable, of } from "rxjs";
import { describe, expect, it, vi } from "vitest";

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
		set(value) {
			signal.set(value);
		},
	};
}

function createMockClient(
	name: string,
	authorizationHeader = `Bearer ${name}`,
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

function createAngularEnvironmentProviders(
	clients: readonly ClientRegistryEntry<BaseOidcModeClient>[] = [],
) {
	return [
		provideEnvironment({
			environment: (providers) => createFoundationEnvironment({ providers }),
		}),
		...provideTokenSetClientRegistry({ clients }),
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

	it("supports bearer interception from the core registry service", async () => {
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

			await expect(
				firstValueFrom(
					interceptor({ url: "https://api.example.com/data", clone }, next),
				),
			).resolves.toMatchObject({
				headers: { Authorization: "Bearer api" },
			});
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
		const observable = signalToObservable(signal);
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
		expectReplayValue(createMockClient("main").authorizationHeaderValue);
	});
});
