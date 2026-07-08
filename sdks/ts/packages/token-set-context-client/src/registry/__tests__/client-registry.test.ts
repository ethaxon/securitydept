import {
	type CancellationTokenTrait,
	ClientError,
	ClientErrorKind,
	createCancellationTokenSource,
	createEventSubject,
	createFoundationEnvironment,
	type DisposableTrait,
	type ReadableSignalTrait,
	ResourceStatus,
	SYMBOL_DISPOSE,
	UriReferenceString,
} from "@securitydept/client";
import { describe, expect, it, vi } from "vitest";
import {
	type BaseOidcModeClient,
	createTokenSetAuthEvent,
	TokenSetAuthEventType,
} from "../../orchestration";
import { type TokenSetAuthEvent } from "../../orchestration/events/auth-events";
import {
	type TokenSetClientCallbackUrls,
	type TokenSetClientFactoryOptions,
	TokenSetClientInitializationMode,
	type TokenSetClientReadyRecordView,
	type TokenSetClientRecordView,
	type TokenSetClientRegistryEntry,
} from "../contracts/types";
import { TokenSetClientRecord } from "../core/client-record";
import { TokenSetClientRegistry } from "../core/client-registry";
import { TokenSetClientRegistryErrorCode } from "../core/error";
import { TokenSetClientRegistryEventType } from "../index";

const testEnvironment = createFoundationEnvironment({});

interface TestClient extends DisposableTrait {
	readonly id: string;
	readonly authEvents: ReturnType<typeof createEventSubject<TokenSetAuthEvent>>;
}

function createClient(id: string): TestClient {
	const dispose = vi.fn();
	return {
		id,
		authEvents: createEventSubject<TokenSetAuthEvent>(),
		dispose,
		[SYMBOL_DISPOSE]: dispose,
	};
}

function createDeferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function createRegistryEntry(options: {
	key: string;
	clientFactory: TokenSetClientRegistryEntry<TestClient>["clientFactory"];
	initialization?: TokenSetClientInitializationMode;
	urlPatterns?: ReadonlyArray<string | RegExp | ((url: string) => boolean)>;
	callbackUrl?: TokenSetClientCallbackUrls;
	requirementKind?: string;
	providerFamily?: string;
}): TokenSetClientRegistryEntry<TestClient> {
	return {
		clientFactory: options.clientFactory,
		meta: {
			clientKey: options.key,
			urlPatterns: options.urlPatterns ?? [],
			callbackUrl: options.callbackUrl,
			requirementKind: options.requirementKind,
			providerFamily: options.providerFamily,
			initialization:
				options.initialization ?? TokenSetClientInitializationMode.Immediate,
		},
	};
}

describe("TokenSetClientRegistry", () => {
	const uuidV7Pattern =
		/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

	it("initializes immediate clients and publishes state, signal, and events", async () => {
		const client = createClient("main");
		const registry = TokenSetClientRegistry.fromEnvironmentConfig<TestClient>({
			environment: testEnvironment,
		});
		const events: string[] = [];
		registry.events.subscribe({
			next: (event: { type: string }) => events.push(event.type),
		});

		registry.register(
			createRegistryEntry({
				key: "main",
				clientFactory: () => client,
			}),
		);

		await expect(registry.clientResourceFor("main").whenValue()).resolves.toBe(
			client,
		);
		const record = registry.clientRecordFor("main").get();
		expect(record.client).toBe(client);
		expect(record.status).toBe(ResourceStatus.Resolved);
		expect(registry.entries.get()).toMatchObject([
			{
				meta: { clientKey: "main" },
				status: ResourceStatus.Resolved,
			},
		]);
		expect(registry.entries.get()[0]?.id).toMatch(uuidV7Pattern);
		expect(events).toEqual([
			TokenSetClientRegistryEventType.Registered,
			TokenSetClientRegistryEventType.Initializing,
			TokenSetClientRegistryEventType.Ready,
		]);
	});

	it("multiplexes auth events and client errors from every ready client", async () => {
		const first = createClient("first");
		const second = createClient("second");
		const registry = TokenSetClientRegistry.fromEnvironmentConfig<TestClient>({
			environment: testEnvironment,
		});
		const authEvents: TokenSetAuthEvent[] = [];
		const errors: ClientError[] = [];
		registry.authEvents.subscribe({ next: (event) => authEvents.push(event) });
		registry.errors.subscribe({ next: (error) => errors.push(error) });

		registry.register(
			createRegistryEntry({ key: "first", clientFactory: () => first }),
		);
		registry.register(
			createRegistryEntry({ key: "second", clientFactory: () => second }),
		);
		await Promise.all([
			registry.clientResourceFor("first").whenValue(),
			registry.clientResourceFor("second").whenValue(),
		]);

		const error = new ClientError({
			kind: ClientErrorKind.Server,
			message: "refresh failed",
		});
		const event = createTokenSetAuthEvent({
			id: "first-error",
			type: TokenSetAuthEventType.AuthMaterialRestoreFailed,
			at: 0,
			payload: {
				type: TokenSetAuthEventType.AuthMaterialRestoreFailed,
				client: { id: first.id },
				persisted: true,
				error,
			},
		});
		first.authEvents.next(event);

		expect(authEvents).toEqual([event]);
		expect(errors).toEqual([error]);

		registry.unregister("first");
		first.authEvents.next(event);
		expect(authEvents).toEqual([event]);
		expect(errors).toEqual([error]);
	});

	it("passes the registry environment and record metadata to the client factory", async () => {
		const client = createClient("factory-options");
		const factory = vi.fn((_options: TokenSetClientFactoryOptions) => client);
		const entry = createRegistryEntry({
			key: "factory-options",
			clientFactory: factory,
			callbackUrl: ["/callback", "/alternate-callback"],
		});
		const registry = TokenSetClientRegistry.fromEnvironmentConfig<TestClient>({
			environment: testEnvironment,
		});

		registry.register(entry);
		await registry.clientResourceFor("factory-options").whenValue();

		expect(factory).toHaveBeenCalledOnce();
		expect(factory.mock.calls[0]?.[0]).toMatchObject({
			environment: testEnvironment,
			meta: entry.meta,
		});
		expect(factory.mock.calls[0]?.[0].cancellationToken).toBeDefined();
	});

	it("defaults the registry generic to BaseOidcModeClient", () => {
		const registry: {
			clientRecordFor(
				key: string,
				options: { readonly initialize: true },
			): Promise<TokenSetClientReadyRecordView<BaseOidcModeClient>>;
			clientRecordFor(
				key: string,
			): ReadableSignalTrait<TokenSetClientRecordView<BaseOidcModeClient>>;
		} = TokenSetClientRegistry.fromEnvironmentConfig({
			environment: testEnvironment,
		});

		expect(registry).toBeDefined();
	});

	it("initializes lazy clients when clientResourceFor is requested", async () => {
		const factory = vi.fn(() => createClient("lazy"));
		const registry = TokenSetClientRegistry.fromEnvironmentConfig<TestClient>({
			environment: testEnvironment,
		});

		registry.register(
			createRegistryEntry({
				key: "lazy",
				initialization: TokenSetClientInitializationMode.Lazy,
				clientFactory: factory,
			}),
		);

		expect(factory).not.toHaveBeenCalled();
		expect(registry.clientRecordFor("lazy").get().status).toBe(
			ResourceStatus.Idle,
		);

		const signal = registry.clientResourceFor("lazy");
		const client = await signal.whenValue();
		expect(client?.id).toBe("lazy");
		expect(factory).toHaveBeenCalledTimes(1);
		expect(registry.clientRecordFor("lazy").get().status).toBe(
			ResourceStatus.Resolved,
		);
		expect(signal.snapshot.get()).toEqual({
			status: "resolved",
			value: client,
		});
	});

	it("keeps lazy clients uninitialized when clientResourceFor disables initialization", () => {
		const factory = vi.fn(() => createClient("lazy"));
		const registry = TokenSetClientRegistry.fromEnvironmentConfig<TestClient>({
			environment: testEnvironment,
		});

		registry.register(
			createRegistryEntry({
				key: "lazy",
				initialization: TokenSetClientInitializationMode.Lazy,
				clientFactory: factory,
			}),
		);

		const signal = registry.clientResourceFor("lazy", { initialize: false });
		expect(factory).not.toHaveBeenCalled();
		expect(signal.hasValue()).toBe(false);
		expect(registry.clientRecordFor("lazy").get().status).toBe(
			ResourceStatus.Idle,
		);
	});

	it("returns the ready client when initialize is called again", async () => {
		const client = createClient("main");
		const factory = vi.fn(() => client);
		const registry = TokenSetClientRegistry.fromEnvironmentConfig<TestClient>({
			environment: testEnvironment,
		});

		registry.register(
			createRegistryEntry({
				key: "main",
				clientFactory: factory,
			}),
		);

		await registry.clientResourceFor("main").whenValue();

		await expect(
			registry.clientRecordFor("main", { initialize: true }),
		).resolves.toMatchObject({
			client,
			status: ResourceStatus.Resolved,
		});
		expect(factory).toHaveBeenCalledTimes(1);
	});

	it("derives granular state signals from registry revisions", async () => {
		const registry = TokenSetClientRegistry.fromEnvironmentConfig<TestClient>({
			environment: testEnvironment,
		});
		registry.register(
			createRegistryEntry({
				key: "lazy",
				initialization: TokenSetClientInitializationMode.Lazy,
				clientFactory: () => createClient("lazy"),
			}),
		);
		const viewSignal = registry.clientRecordFor("lazy");
		const registeredView = viewSignal.get();

		expect(registry.entries.get()).toMatchObject([
			{
				meta: { clientKey: "lazy" },
				status: ResourceStatus.Idle,
			},
		]);

		await registry.clientRecordFor("lazy", { initialize: true });
		const readyView = viewSignal.get();

		expect(registry.entries.get()).toMatchObject([
			{
				meta: { clientKey: "lazy" },
				status: ResourceStatus.Resolved,
			},
		]);
		expect(readyView).not.toBe(registeredView);
		expect(readyView).not.toHaveProperty("initialize");
		expect(readyView).not.toHaveProperty("dispose");
	});

	it("schedules idle clients only when an idle callback capability is provided", async () => {
		const callbacks: Array<() => void> = [];
		const registry = TokenSetClientRegistry.fromEnvironmentConfig<TestClient>({
			environment: createFoundationEnvironment({
				idleCallback: {
					requestIdleCallback: (callback) => {
						callbacks.push(callback);
						return callback;
					},
					cancelIdleCallback: (handle) => {
						const index = callbacks.indexOf(handle as () => void);
						if (index >= 0) {
							callbacks.splice(index, 1);
						}
					},
				},
			}),
		});
		const factory = vi.fn(() => createClient("idle"));

		registry.register(
			createRegistryEntry({
				key: "idle",
				initialization: TokenSetClientInitializationMode.Idle,
				clientFactory: factory,
			}),
		);
		expect(factory).not.toHaveBeenCalled();
		expect(callbacks).toHaveLength(1);

		callbacks[0]();
		await registry.clientResourceFor("idle").whenValue();
		expect(factory).toHaveBeenCalledTimes(1);
	});

	it("does not initialize idle clients without idle callback fallback", () => {
		const factory = vi.fn(() => createClient("idle"));
		const registry = TokenSetClientRegistry.fromEnvironmentConfig<TestClient>({
			environment: testEnvironment,
		});

		registry.register(
			createRegistryEntry({
				key: "idle",
				initialization: TokenSetClientInitializationMode.Idle,
				clientFactory: factory,
			}),
		);

		expect(factory).not.toHaveBeenCalled();
		expect(registry.clientRecordFor("idle").get().status).toBe(
			ResourceStatus.Idle,
		);
	});

	it("reuses the in-flight record initialization", async () => {
		const deferred = createDeferred<TestClient>();
		const factory = vi.fn(() => deferred.promise);
		const registry = TokenSetClientRegistry.fromEnvironmentConfig<TestClient>({
			environment: testEnvironment,
		});
		registry.register(
			createRegistryEntry({
				key: "async",
				initialization: TokenSetClientInitializationMode.Lazy,
				clientFactory: factory,
			}),
		);

		const first = registry.clientRecordFor("async", { initialize: true });
		const second = registry.clientRecordFor("async", { initialize: true });

		const client = createClient("async");
		deferred.resolve(client);
		await expect(first).resolves.toMatchObject({
			client,
			status: ResourceStatus.Resolved,
		});
		await expect(second).resolves.toMatchObject({
			client,
			status: ResourceStatus.Resolved,
		});
		expect(factory).toHaveBeenCalledTimes(1);
	});

	it("cancels in-flight factory initialization when its record is unregistered", async () => {
		const deferred = createDeferred<TestClient>();
		const client = createClient("late");
		let factoryCancellationToken: CancellationTokenTrait | undefined;
		const registry = TokenSetClientRegistry.fromEnvironmentConfig<TestClient>({
			environment: testEnvironment,
		});
		registry.register(
			createRegistryEntry({
				key: "async",
				initialization: TokenSetClientInitializationMode.Lazy,
				clientFactory: ({ cancellationToken }) => {
					factoryCancellationToken = cancellationToken;
					return deferred.promise;
				},
			}),
		);

		registry.clientResourceFor("async");
		registry.unregister("async");

		expect(factoryCancellationToken?.isCancellationRequested).toBe(true);

		deferred.resolve(client);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(client.dispose).toHaveBeenCalledTimes(1);
	});

	it("disposes a client that cannot be adopted after initialization cancellation", async () => {
		const deferred = createDeferred<TestClient>();
		const client = createClient("completed-after-cancellation");
		using record = TokenSetClientRecord.fromRegistered(
			createRegistryEntry({
				key: "direct",
				initialization: TokenSetClientInitializationMode.Lazy,
				clientFactory: () => deferred.promise,
			}),
		);
		const cancellation = createCancellationTokenSource();
		const pending = record.initialize({
			cancellationToken: cancellation.token,
			environment: testEnvironment,
		});

		cancellation.cancel();
		deferred.resolve(client);
		await expect(pending).rejects.toBe(cancellation.token.cancellationError);

		expect(record.view.get()).toMatchObject({
			status: ResourceStatus.LoadingError,
			error: cancellation.token.cancellationError,
		});
		expect(client.dispose).toHaveBeenCalledTimes(1);
	});

	it("records cancellation as a failure while the record remains alive", async () => {
		const deferred = createDeferred<TestClient>();
		const record = TokenSetClientRecord.fromRegistered(
			createRegistryEntry({
				key: "cancelled",
				initialization: TokenSetClientInitializationMode.Lazy,
				clientFactory: () => deferred.promise,
			}),
		);
		const cancellation = createCancellationTokenSource();
		const pending = record.initialize({
			cancellationToken: cancellation.token,
			environment: testEnvironment,
		});

		cancellation.cancel();
		deferred.reject(cancellation.token.cancellationError);
		await expect(pending).rejects.toBe(cancellation.token.cancellationError);

		expect(record.view.get()).toMatchObject({
			status: ResourceStatus.LoadingError,
			error: cancellation.token.cancellationError,
		});
	});

	it("records failed initialization and rejects callers", async () => {
		const error = new Error("boom");
		const registry = TokenSetClientRegistry.fromEnvironmentConfig<TestClient>({
			environment: testEnvironment,
		});
		const errors: ClientError[] = [];
		registry.errors.subscribe({
			next: (clientError) => errors.push(clientError),
		});
		registry.register(
			createRegistryEntry({
				key: "flaky",
				initialization: TokenSetClientInitializationMode.Lazy,
				clientFactory: () => {
					throw error;
				},
			}),
		);

		await expect(
			registry.clientRecordFor("flaky", { initialize: true }),
		).rejects.toMatchObject({
			code: TokenSetClientRegistryErrorCode.ClientFactoryFailed,
			cause: error,
		});
		expect(registry.clientResourceFor("flaky").snapshot.get()).toEqual({
			status: ResourceStatus.LoadingError,
			error: expect.objectContaining({
				code: TokenSetClientRegistryErrorCode.ClientFactoryFailed,
				cause: error,
			}),
		});
		expect(registry.clientRecordFor("flaky").get().status).toBe(
			ResourceStatus.LoadingError,
		);
		expect(errors).toEqual([
			expect.objectContaining({
				code: TokenSetClientRegistryErrorCode.ClientFactoryFailed,
				cause: error,
			}),
		]);
		expect(registry.entries.get()).toMatchObject([
			{
				meta: { clientKey: "flaky" },
				status: ResourceStatus.LoadingError,
			},
		]);
	});

	it("lets clientResourceForQuery initialize lazy clients by default", async () => {
		const factory = vi.fn(() => createClient("lazy"));
		const registry = TokenSetClientRegistry.fromEnvironmentConfig<TestClient>({
			environment: testEnvironment,
		});
		registry.register(
			createRegistryEntry({
				key: "lazy",
				initialization: TokenSetClientInitializationMode.Lazy,
				clientFactory: async () => factory(),
				requirementKind: "workspace",
			}),
		);

		const signal = registry.clientResourceForQuery({
			requirementKind: "workspace",
		});
		expect(signal).toBeDefined();
		await expect(signal?.whenValue()).resolves.toMatchObject({ id: "lazy" });
		expect(factory).toHaveBeenCalledTimes(1);
	});

	it("keeps query-selected lazy clients uninitialized when signal initialization is disabled", () => {
		const factory = vi.fn(() => createClient("lazy"));
		const registry = TokenSetClientRegistry.fromEnvironmentConfig<TestClient>({
			environment: testEnvironment,
		});
		registry.register(
			createRegistryEntry({
				key: "lazy",
				initialization: TokenSetClientInitializationMode.Lazy,
				clientFactory: factory,
				requirementKind: "workspace",
			}),
		);

		const signal = registry.clientResourceForQuery(
			{ requirementKind: "workspace" },
			{ initialize: false },
		);
		expect(signal).toBeDefined();
		expect(factory).not.toHaveBeenCalled();
		expect(registry.clientRecordFor("lazy").get().status).toBe(
			ResourceStatus.Idle,
		);
	});

	it("returns ready record views when record lookup requests initialization", async () => {
		const registry = TokenSetClientRegistry.fromEnvironmentConfig<TestClient>({
			environment: testEnvironment,
		});
		registry.register(
			createRegistryEntry({
				key: "lazy",
				initialization: TokenSetClientInitializationMode.Lazy,
				clientFactory: () => createClient("lazy"),
				requirementKind: "workspace",
			}),
		);

		const passiveRecord = registry.clientRecordForQuery({
			requirementKind: "workspace",
		});
		expect(passiveRecord?.get().status).toBe(ResourceStatus.Idle);

		const readyRecord = await registry.clientRecordForQuery(
			{ requirementKind: "workspace" },
			{ initialize: true },
		);
		expect(readyRecord).toMatchObject({
			id: passiveRecord?.get().id,
			status: ResourceStatus.Resolved,
			client: { id: "lazy" },
		});
		await expect(
			registry.clientRecordOptionFor("missing", { initialize: true }),
		).resolves.toBeUndefined();
	});

	it("re-registering the same key creates a new record and leaves the prior resource idle", async () => {
		const first = createClient("first");
		const second = createClient("second");
		const registry = TokenSetClientRegistry.fromEnvironmentConfig<TestClient>({
			environment: testEnvironment,
		});

		registry.register(
			createRegistryEntry({ key: "main", clientFactory: () => first }),
		);
		const firstSignal = registry.clientResourceFor("main");
		await expect(firstSignal.whenValue()).resolves.toBe(first);
		const firstRecordId = registry.entries.get()[0]?.id;

		registry.unregister("main");
		expect(firstSignal.snapshot.get()).toEqual({ status: ResourceStatus.Idle });

		registry.register(
			createRegistryEntry({ key: "main", clientFactory: () => second }),
		);
		await expect(registry.clientResourceFor("main").whenValue()).resolves.toBe(
			second,
		);

		expect(registry.entries.get()[0]?.id).toMatch(uuidV7Pattern);
		expect(registry.entries.get()[0]?.id).not.toBe(firstRecordId);
		expect(firstSignal.snapshot.get()).toEqual({ status: ResourceStatus.Idle });
	});

	it("disposes registered clients on unregister and dispose", async () => {
		const first = createClient("first");
		const second = createClient("second");
		{
			using registry = TokenSetClientRegistry.fromEnvironmentConfig<TestClient>(
				{
					environment: testEnvironment,
				},
			);
			registry.register(
				createRegistryEntry({ key: "first", clientFactory: () => first }),
			);
			registry.register(
				createRegistryEntry({ key: "second", clientFactory: () => second }),
			);
			await registry.clientRecordFor("first", { initialize: true });
			await registry.clientRecordFor("second", { initialize: true });

			expect(registry.unregister("first")).toBe(true);
			expect(first.dispose).toHaveBeenCalledTimes(1);
		}
		expect(second.dispose).toHaveBeenCalledTimes(1);
	});

	it("keeps metadata lookup separate from initialization", () => {
		const factory = vi.fn(() => createClient("api"));
		const registry = TokenSetClientRegistry.fromEnvironmentConfig<TestClient>({
			environment: testEnvironment,
		});
		registry.register(
			createRegistryEntry({
				key: "api",
				initialization: TokenSetClientInitializationMode.Lazy,
				clientFactory: factory,
				urlPatterns: ["/api/"],
				callbackUrl: ["/auth/callback", "/auth/alternate-callback"],
				requirementKind: "session",
				providerFamily: "internal",
			}),
		);

		expect(
			registry.clientRecordForQuery({ url: "/api/me" })?.get().meta.clientKey,
		).toBe("api");
		expect(
			registry
				.clientRecordForQuery({
					callbackUrl: [
						"https://app.test/not-a-callback",
						UriReferenceString.parse(
							"https://app.test/auth/alternate-callback?code=1",
						),
					],
				})
				?.get().meta.clientKey,
		).toBe("api");
		expect(
			registry.clientRecordForQuery({ requirementKind: "session" })?.get().meta
				.clientKey,
		).toBe("api");
		expect(
			registry.clientRecordForQuery({ providerFamily: "internal" })?.get().meta
				.clientKey,
		).toBe("api");
		expect(factory).not.toHaveBeenCalled();
	});
});
