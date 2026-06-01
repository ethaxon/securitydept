import {
	type DisposableTrait,
	type ReadableSignalTrait,
	SYMBOL_DISPOSE,
} from "@securitydept/client";
import { describe, expect, it, vi } from "vitest";
import { type BaseOidcModeClient } from "../../orchestration";
import {
	TokenSetClientInitializationMode,
	type TokenSetClientReadyRecordView,
	type TokenSetClientRegistryEntry,
	TokenSetClientRegistryEntryStatus,
	TokenSetClientRegistryEventType,
} from "../contracts/types";
import { type TokenSetClientRecord } from "../core/client-record";
import { createTokenSetClientRegistry } from "../core/client-registry";

interface TestClient extends DisposableTrait {
	readonly id: string;
}

function createClient(id: string): TestClient {
	const dispose = vi.fn();
	return {
		id,
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
	clientFactory: () => TestClient | Promise<TestClient>;
	initialization?: TokenSetClientInitializationMode;
	urlPatterns?: ReadonlyArray<string | RegExp | ((url: string) => boolean)>;
	callbackPath?: string;
	requirementKind?: string;
	providerFamily?: string;
}): TokenSetClientRegistryEntry<TestClient> {
	return {
		clientFactory: options.clientFactory,
		meta: {
			clientKey: options.key,
			urlPatterns: options.urlPatterns ?? [],
			callbackPath: options.callbackPath,
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
		const registry = createTokenSetClientRegistry<TestClient>({
			environment: {},
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

		await expect(registry.clientSignalFor("main").whenValue()).resolves.toBe(
			client,
		);
		const record = registry.clientRecordFor("main").get();
		expect(record.client).toBe(client);
		expect(record.status).toBe(TokenSetClientRegistryEntryStatus.Ready);
		expect(registry.entries.get()).toMatchObject([
			{
				meta: { clientKey: "main" },
				status: TokenSetClientRegistryEntryStatus.Ready,
			},
		]);
		expect(registry.entries.get()[0]?.id).toMatch(uuidV7Pattern);
		expect(events).toEqual([
			TokenSetClientRegistryEventType.Registered,
			TokenSetClientRegistryEventType.Initializing,
			TokenSetClientRegistryEventType.Ready,
		]);
	});

	it("defaults the registry generic to BaseOidcModeClient", () => {
		const registry: {
			initialize(
				key: string,
			): Promise<TokenSetClientReadyRecordView<BaseOidcModeClient>>;
			clientRecordFor(
				key: string,
			): ReadableSignalTrait<TokenSetClientRecord<BaseOidcModeClient>>;
		} = createTokenSetClientRegistry({
			environment: {},
		});

		expect(registry).toBeDefined();
	});

	it("initializes lazy clients when clientSignalFor is requested", async () => {
		const factory = vi.fn(() => createClient("lazy"));
		const registry = createTokenSetClientRegistry<TestClient>({
			environment: {},
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
			TokenSetClientRegistryEntryStatus.Registered,
		);

		const signal = registry.clientSignalFor("lazy");
		const client = await signal.whenValue();
		expect(client.id).toBe("lazy");
		expect(factory).toHaveBeenCalledTimes(1);
		expect(registry.clientRecordFor("lazy").get().status).toBe(
			TokenSetClientRegistryEntryStatus.Ready,
		);
		expect(signal.get()).toEqual({
			kind: "value",
			value: client,
		});
	});

	it("keeps lazy clients uninitialized when clientSignalFor disables initialization", () => {
		const factory = vi.fn(() => createClient("lazy"));
		const registry = createTokenSetClientRegistry<TestClient>({
			environment: {},
		});

		registry.register(
			createRegistryEntry({
				key: "lazy",
				initialization: TokenSetClientInitializationMode.Lazy,
				clientFactory: factory,
			}),
		);

		const signal = registry.clientSignalFor("lazy", { initialize: false });
		expect(factory).not.toHaveBeenCalled();
		expect(signal.hasValue()).toBe(false);
		expect(registry.clientRecordFor("lazy").get().status).toBe(
			TokenSetClientRegistryEntryStatus.Registered,
		);
	});

	it("returns the ready client when initialize is called again", async () => {
		const client = createClient("main");
		const factory = vi.fn(() => client);
		const registry = createTokenSetClientRegistry<TestClient>({
			environment: {},
		});

		registry.register(
			createRegistryEntry({
				key: "main",
				clientFactory: factory,
			}),
		);

		await registry.clientSignalFor("main").whenValue();

		await expect(registry.initialize("main")).resolves.toMatchObject({
			client,
			status: TokenSetClientRegistryEntryStatus.Ready,
		});
		expect(factory).toHaveBeenCalledTimes(1);
	});

	it("derives granular state signals from registry revisions", async () => {
		const registry = createTokenSetClientRegistry<TestClient>({
			environment: {},
		});
		registry.register(
			createRegistryEntry({
				key: "lazy",
				initialization: TokenSetClientInitializationMode.Lazy,
				clientFactory: () => createClient("lazy"),
			}),
		);

		expect(registry.entries.get()).toMatchObject([
			{
				meta: { clientKey: "lazy" },
				status: TokenSetClientRegistryEntryStatus.Registered,
			},
		]);

		await registry.initialize("lazy");

		expect(registry.entries.get()).toMatchObject([
			{
				meta: { clientKey: "lazy" },
				status: TokenSetClientRegistryEntryStatus.Ready,
			},
		]);
	});

	it("schedules idle clients only when an idle callback capability is provided", async () => {
		const callbacks: Array<() => void> = [];
		const registry = createTokenSetClientRegistry<TestClient>({
			environment: {
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
			},
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
		await registry.clientSignalFor("idle").whenValue();
		expect(factory).toHaveBeenCalledTimes(1);
	});

	it("does not initialize idle clients without idle callback fallback", () => {
		const factory = vi.fn(() => createClient("idle"));
		const registry = createTokenSetClientRegistry<TestClient>({
			environment: {},
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
			TokenSetClientRegistryEntryStatus.Registered,
		);
	});

	it("reuses the in-flight record initialization", async () => {
		const deferred = createDeferred<TestClient>();
		const factory = vi.fn(() => deferred.promise);
		const registry = createTokenSetClientRegistry<TestClient>({
			environment: {},
		});
		registry.register(
			createRegistryEntry({
				key: "async",
				initialization: TokenSetClientInitializationMode.Lazy,
				clientFactory: factory,
			}),
		);

		const first = registry.initialize("async");
		const second = registry.initialize("async");

		const client = createClient("async");
		deferred.resolve(client);
		await expect(first).resolves.toMatchObject({
			client,
			status: TokenSetClientRegistryEntryStatus.Ready,
		});
		await expect(second).resolves.toMatchObject({
			client,
			status: TokenSetClientRegistryEntryStatus.Ready,
		});
		expect(factory).toHaveBeenCalledTimes(1);
	});

	it("rejects in-flight initialization when its record is unregistered", async () => {
		const deferred = createDeferred<TestClient>();
		const client = createClient("late");
		const registry = createTokenSetClientRegistry<TestClient>({
			environment: {},
		});
		registry.register(
			createRegistryEntry({
				key: "async",
				initialization: TokenSetClientInitializationMode.Lazy,
				clientFactory: () => deferred.promise,
			}),
		);

		const pending = registry.initialize("async");
		registry.unregister("async");

		await expect(pending).rejects.toBeDefined();

		deferred.resolve(client);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(client.dispose).toHaveBeenCalledTimes(1);
	});

	it("records failed initialization and rejects callers", async () => {
		const error = new Error("boom");
		const registry = createTokenSetClientRegistry<TestClient>({
			environment: {},
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

		await expect(registry.initialize("flaky")).rejects.toBe(error);
		expect(registry.clientRecordFor("flaky").get().status).toBe(
			TokenSetClientRegistryEntryStatus.Failed,
		);
		expect(registry.entries.get()).toMatchObject([
			{
				meta: { clientKey: "flaky" },
				status: TokenSetClientRegistryEntryStatus.Failed,
			},
		]);
	});

	it("lets clientSignalForQuery initialize lazy clients by default", async () => {
		const factory = vi.fn(() => createClient("lazy"));
		const registry = createTokenSetClientRegistry<TestClient>({
			environment: {},
		});
		registry.register(
			createRegistryEntry({
				key: "lazy",
				initialization: TokenSetClientInitializationMode.Lazy,
				clientFactory: async () => factory(),
				requirementKind: "workspace",
			}),
		);

		const signal = registry.clientSignalForQuery({
			requirementKind: "workspace",
		});
		expect(signal).toBeDefined();
		await expect(signal?.whenValue()).resolves.toMatchObject({ id: "lazy" });
		expect(factory).toHaveBeenCalledTimes(1);
	});

	it("keeps query-selected lazy clients uninitialized when signal initialization is disabled", () => {
		const factory = vi.fn(() => createClient("lazy"));
		const registry = createTokenSetClientRegistry<TestClient>({
			environment: {},
		});
		registry.register(
			createRegistryEntry({
				key: "lazy",
				initialization: TokenSetClientInitializationMode.Lazy,
				clientFactory: factory,
				requirementKind: "workspace",
			}),
		);

		const signal = registry.clientSignalForQuery(
			{ requirementKind: "workspace" },
			{ initialize: false },
		);
		expect(signal).toBeDefined();
		expect(factory).not.toHaveBeenCalled();
		expect(registry.clientRecordFor("lazy").get().status).toBe(
			TokenSetClientRegistryEntryStatus.Registered,
		);
	});

	it("treats re-registering the same key as a new record identity", async () => {
		const first = createClient("first");
		const second = createClient("second");
		const registry = createTokenSetClientRegistry<TestClient>({
			environment: {},
		});

		registry.register(
			createRegistryEntry({ key: "main", clientFactory: () => first }),
		);
		const firstSignal = registry.clientSignalFor("main");
		await expect(firstSignal.whenValue()).resolves.toBe(first);
		const firstRecordId = registry.entries.get()[0]?.id;

		registry.unregister("main");
		expect(firstSignal.get()).toEqual({ kind: "empty" });

		registry.register(
			createRegistryEntry({ key: "main", clientFactory: () => second }),
		);
		await expect(registry.clientSignalFor("main").whenValue()).resolves.toBe(
			second,
		);

		expect(registry.entries.get()[0]?.id).toMatch(uuidV7Pattern);
		expect(registry.entries.get()[0]?.id).not.toBe(firstRecordId);
		expect(firstSignal.get()).toEqual({ kind: "empty" });
	});

	it("disposes registered clients on unregister and dispose", async () => {
		const first = createClient("first");
		const second = createClient("second");
		const registry = createTokenSetClientRegistry<TestClient>({
			environment: {},
		});
		registry.register(
			createRegistryEntry({ key: "first", clientFactory: () => first }),
		);
		registry.register(
			createRegistryEntry({ key: "second", clientFactory: () => second }),
		);
		await registry.initialize("first");
		await registry.initialize("second");

		expect(registry.unregister("first")).toBe(true);
		expect(first.dispose).toHaveBeenCalledTimes(1);

		registry.dispose();
		expect(second.dispose).toHaveBeenCalledTimes(1);
	});

	it("keeps metadata lookup separate from initialization", () => {
		const factory = vi.fn(() => createClient("api"));
		const registry = createTokenSetClientRegistry<TestClient>({
			environment: {},
		});
		registry.register(
			createRegistryEntry({
				key: "api",
				initialization: TokenSetClientInitializationMode.Lazy,
				clientFactory: factory,
				urlPatterns: ["/api/"],
				callbackPath: "/auth/callback",
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
					callbackUrl: "https://app.test/auth/callback?code=1",
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
