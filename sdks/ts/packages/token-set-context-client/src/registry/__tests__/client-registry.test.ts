import { type DisposableTrait, SYMBOL_DISPOSE } from "@securitydept/client";
import { describe, expect, it, vi } from "vitest";
import {
	ClientInitializationMode,
	type ClientRegistryEntry,
	ClientRegistryEntryStatus,
	ClientRegistryEventType,
} from "../contracts/types";
import { createClientRegistry } from "../core/client-registry";

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
	initialization?: ClientInitializationMode;
	urlPatterns?: ReadonlyArray<string | RegExp | ((url: string) => boolean)>;
	callbackPath?: string;
	requirementKind?: string;
	providerFamily?: string;
}): ClientRegistryEntry<TestClient> {
	return {
		clientFactory: options.clientFactory,
		meta: {
			clientKey: options.key,
			urlPatterns: options.urlPatterns ?? [],
			callbackPath: options.callbackPath,
			requirementKind: options.requirementKind,
			providerFamily: options.providerFamily,
			initialization:
				options.initialization ?? ClientInitializationMode.Immediate,
		},
	};
}

describe("ClientRegistry", () => {
	const uuidV7Pattern =
		/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

	it("initializes immediate clients and publishes state, signal, and events", async () => {
		const client = createClient("main");
		const registry = createClientRegistry<TestClient>({ environment: {} });
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
		expect(record.status).toBe(ClientRegistryEntryStatus.Ready);
		expect(registry.entries.get()).toMatchObject([
			{
				meta: { clientKey: "main" },
				status: ClientRegistryEntryStatus.Ready,
			},
		]);
		expect(registry.entries.get()[0]?.id).toMatch(uuidV7Pattern);
		expect(events).toEqual([
			ClientRegistryEventType.Registered,
			ClientRegistryEventType.Initializing,
			ClientRegistryEventType.Ready,
		]);
	});

	it("keeps lazy clients uninitialized until initialize is called", async () => {
		const factory = vi.fn(() => createClient("lazy"));
		const registry = createClientRegistry<TestClient>({ environment: {} });

		registry.register(
			createRegistryEntry({
				key: "lazy",
				initialization: ClientInitializationMode.Lazy,
				clientFactory: factory,
			}),
		);

		expect(factory).not.toHaveBeenCalled();
		expect(registry.clientSignalFor("lazy").hasValue()).toBe(false);
		expect(registry.clientRecordFor("lazy").get().status).toBe(
			ClientRegistryEntryStatus.Registered,
		);

		const client = await registry.initialize("lazy");
		expect(client.id).toBe("lazy");
		expect(factory).toHaveBeenCalledTimes(1);
		expect(registry.clientSignalFor("lazy").get()).toEqual({
			kind: "value",
			value: client,
		});
	});

	it("returns the ready client when initialize is called again", async () => {
		const client = createClient("main");
		const factory = vi.fn(() => client);
		const registry = createClientRegistry<TestClient>({ environment: {} });

		registry.register(
			createRegistryEntry({
				key: "main",
				clientFactory: factory,
			}),
		);

		await registry.clientSignalFor("main").whenValue();

		await expect(registry.initialize("main")).resolves.toBe(client);
		expect(factory).toHaveBeenCalledTimes(1);
	});

	it("derives granular state signals from registry revisions", async () => {
		const registry = createClientRegistry<TestClient>({ environment: {} });
		registry.register(
			createRegistryEntry({
				key: "lazy",
				initialization: ClientInitializationMode.Lazy,
				clientFactory: () => createClient("lazy"),
			}),
		);

		expect(registry.entries.get()).toMatchObject([
			{
				meta: { clientKey: "lazy" },
				status: ClientRegistryEntryStatus.Registered,
			},
		]);

		await registry.initialize("lazy");

		expect(registry.entries.get()).toMatchObject([
			{ meta: { clientKey: "lazy" }, status: ClientRegistryEntryStatus.Ready },
		]);
	});

	it("schedules idle clients only when an idle callback capability is provided", async () => {
		const callbacks: Array<() => void> = [];
		const registry = createClientRegistry<TestClient>({
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
				initialization: ClientInitializationMode.Idle,
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
		const registry = createClientRegistry<TestClient>({ environment: {} });

		registry.register(
			createRegistryEntry({
				key: "idle",
				initialization: ClientInitializationMode.Idle,
				clientFactory: factory,
			}),
		);

		expect(factory).not.toHaveBeenCalled();
		expect(registry.clientRecordFor("idle").get().status).toBe(
			ClientRegistryEntryStatus.Registered,
		);
	});

	it("reuses the in-flight record initialization", async () => {
		const deferred = createDeferred<TestClient>();
		const factory = vi.fn(() => deferred.promise);
		const registry = createClientRegistry<TestClient>({ environment: {} });
		registry.register(
			createRegistryEntry({
				key: "async",
				initialization: ClientInitializationMode.Lazy,
				clientFactory: factory,
			}),
		);

		const first = registry.initialize("async");
		const second = registry.initialize("async");

		const client = createClient("async");
		deferred.resolve(client);
		await expect(first).resolves.toBe(client);
		await expect(second).resolves.toBe(client);
		expect(factory).toHaveBeenCalledTimes(1);
	});

	it("rejects in-flight initialization when its record is unregistered", async () => {
		const deferred = createDeferred<TestClient>();
		const client = createClient("late");
		const registry = createClientRegistry<TestClient>({ environment: {} });
		registry.register(
			createRegistryEntry({
				key: "async",
				initialization: ClientInitializationMode.Lazy,
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
		const registry = createClientRegistry<TestClient>({ environment: {} });
		registry.register(
			createRegistryEntry({
				key: "flaky",
				initialization: ClientInitializationMode.Lazy,
				clientFactory: () => {
					throw error;
				},
			}),
		);

		await expect(registry.initialize("flaky")).rejects.toBe(error);
		expect(registry.clientRecordFor("flaky").get().status).toBe(
			ClientRegistryEntryStatus.Failed,
		);
		expect(registry.entries.get()).toMatchObject([
			{
				meta: { clientKey: "flaky" },
				status: ClientRegistryEntryStatus.Failed,
			},
		]);
	});

	it("does not let clientSignalFor trigger initialization", () => {
		const factory = vi.fn(() => createClient("lazy"));
		const registry = createClientRegistry<TestClient>({ environment: {} });
		registry.register(
			createRegistryEntry({
				key: "lazy",
				initialization: ClientInitializationMode.Lazy,
				clientFactory: factory,
			}),
		);

		registry.clientSignalFor("lazy");
		expect(factory).not.toHaveBeenCalled();
	});

	it("treats re-registering the same key as a new record identity", async () => {
		const first = createClient("first");
		const second = createClient("second");
		const registry = createClientRegistry<TestClient>({ environment: {} });

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
		const registry = createClientRegistry<TestClient>({ environment: {} });
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
		const registry = createClientRegistry<TestClient>({ environment: {} });
		registry.register(
			createRegistryEntry({
				key: "api",
				initialization: ClientInitializationMode.Lazy,
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
