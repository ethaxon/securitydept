import {
	createSubject,
	type FoundationEnvironment,
	type ReadableReplaySignalTrait,
} from "@securitydept/client";
import { describe, expect, it, vi } from "vitest";
import { ClientReadinessState } from "../../frontend-oidc-mode/config/config-source";
import type { TokenSetAuthEvent } from "../../orchestration";
import {
	ClientInitializationPriority,
	TokenSetAuthRegistryLifecycleError,
	TokenSetAuthRegistryLifecycleErrorCode,
} from "../contracts/types";
import {
	createTokenSetAuthRegistry,
	type TokenSetAuthRegistry,
} from "../core/client-registry";

interface FakeClient {
	readonly name: string;
	authEvents: ReturnType<typeof createSubject<TokenSetAuthEvent>>;
	dispose: () => void;
}

interface FakeService {
	readonly client: FakeClient;
	readonly authEvents: ReturnType<typeof createSubject<TokenSetAuthEvent>>;
	disposed: boolean;
	disposeCount: number;
}

const TEST_IDLE_CALLBACK = {
	requestIdleCallback: (callback: () => void) => setTimeout(callback, 0),
	cancelIdleCallback: (handle: unknown) =>
		clearTimeout(handle as ReturnType<typeof setTimeout>),
};
const TEST_ENVIRONMENT: FoundationEnvironment = {
	transport: { execute: async () => ({ status: 204, headers: {} }) },
	time: {
		now: () => Date.now(),
		setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
		clearTimeout: (handle) =>
			clearTimeout(handle as ReturnType<typeof setTimeout>),
	},
	idleCallback: TEST_IDLE_CALLBACK,
};

function createDeferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function createClient(name: string): FakeClient {
	return {
		name,
		authEvents: createSubject<TokenSetAuthEvent>(),
		dispose: vi.fn<() => void>(() => undefined),
	};
}

function expectReplayValue<T>(signal: ReadableReplaySignalTrait<T>): T {
	const slot = signal.get();
	expect(slot.kind).toBe("value");
	if (slot.kind !== "value") {
		throw new Error("Expected replay signal value.");
	}
	return slot.value;
}

function createRegistry(options?: {
	start?: (client: FakeClient, service: FakeService) => Promise<void> | void;
}) {
	return createTokenSetAuthRegistry<FakeClient, FakeService>({
		materialize: (client) => ({
			client,
			authEvents: client.authEvents,
			disposed: false,
			disposeCount: 0,
		}),
		dispose: (service) => {
			service.disposed = true;
			service.disposeCount += 1;
			service.client.dispose();
		},
		start: options?.start,
		authEventsOf: (service) => service.authEvents,
		environment: TEST_ENVIRONMENT,
	});
}

describe("TokenSetAuthRegistry lifecycle", () => {
	it("runs the start hook before ready state and clientSignalFor emission", async () => {
		const start = vi.fn(async () => undefined);
		const registry = createRegistry({ start });
		const factory = vi.fn<() => FakeClient>(() => createClient("lazy"));

		registry.register({
			key: "lazy",
			priority: ClientInitializationPriority.Lazy,
			clientFactory: factory,
		});

		expect(factory).not.toHaveBeenCalled();
		const signal = registry.clientSignalFor("lazy");
		expect(signal.hasValue()).toBe(false);

		const ready = registry.clientSignalFor("lazy").whenValue();
		const service = await ready;

		expect(factory).toHaveBeenCalledTimes(1);
		expect(start).toHaveBeenCalledWith(
			service.client,
			service,
			expect.anything(),
		);
		expect(expectReplayValue(signal)).toBe(service);
		expect(registry.readyKeys()).toEqual(["lazy"]);
		registry.dispose();
	});

	it("keeps clientSignalFor empty and records failure when start fails", async () => {
		const startError = new Error("start failed");
		const registry = createRegistry({
			start: async () => {
				throw startError;
			},
		});
		registry.register({
			key: "lazy",
			priority: ClientInitializationPriority.Lazy,
			clientFactory: () => createClient("lazy"),
		});
		const signal = registry.clientSignalFor("lazy");

		await expect(registry.whenReady("lazy")).rejects.toBe(startError);

		expect(signal.hasValue()).toBe(false);
		expect(registry.readinessState("lazy")).toBe(ClientReadinessState.Failed);
		expect(registry.state.get().entries[0]?.lifecycleError).toBe(startError);
		registry.dispose();
	});

	it("clears but reuses clientSignalFor across resetMaterialization", async () => {
		const registry = createRegistry();
		const factory = vi
			.fn<() => FakeClient>()
			.mockReturnValueOnce(createClient("first"))
			.mockReturnValueOnce(createClient("second"));
		registry.register({
			key: "lazy",
			priority: ClientInitializationPriority.Lazy,
			clientFactory: factory,
		});
		const signal = registry.clientSignalFor("lazy");
		const first = await signal.whenValue();
		expect(first.client.name).toBe("first");

		registry.resetMaterialization("lazy");
		expect(signal.hasValue()).toBe(false);

		const secondPromise = signal.whenValue();
		await registry.whenReady("lazy");
		const second = await secondPromise;
		expect(second.client.name).toBe("second");
		expect(second).not.toBe(first);
		registry.dispose();
	});

	it("unregister() disposes ready services, drops indexes, stops auth events, and allows re-register", () => {
		const registry = createRegistry();
		const events: TokenSetAuthEvent[] = [];
		registry.authEvents.subscribe({ next: (event) => events.push(event) });

		const service = registry.register({
			key: "main",
			clientFactory: () => createClient("main"),
			urlPatterns: ["https://api.example.com"],
			callbackPath: "/auth/callback",
			requirementKind: "workspace",
			providerFamily: "internal",
		}) as FakeService;

		expect(registry.has("main")).toBe(true);
		expect(registry.registeredKeys()).toEqual(["main"]);
		expect(registry.readyKeys()).toEqual(["main"]);
		expect(registry.unregister("main")).toBe(true);
		expect(registry.unregister("main")).toBe(false);
		expect(service.disposed).toBe(true);
		expect(service.disposeCount).toBe(1);
		expect(service.client.dispose).toHaveBeenCalledTimes(1);
		expect(registry.has("main")).toBe(false);
		expect(registry.registeredKeys()).toEqual([]);
		expect(registry.readyKeys()).toEqual([]);
		expect(
			registry.clientKeyListForUrl("https://api.example.com/wiki"),
		).toEqual([]);
		expect(
			registry.clientKeyListForCallback(
				"https://app.example.com/auth/callback?code=1&state=2",
			),
		).toEqual([]);
		expect(registry.clientKeyListForRequirement("workspace")).toEqual([]);
		expect(registry.clientKeyListForProviderFamily("internal")).toEqual([]);

		service.authEvents.next({
			id: "event-after-unregister",
			type: "auth.authenticated",
			at: 1,
			source: { kind: "framework", name: "vitest" },
			payload: { outcome: "authenticated" },
		});
		expect(events).toEqual([]);

		const replacement = registry.register({
			key: "main",
			clientFactory: () => createClient("replacement"),
		}) as FakeService;
		expect(replacement.client.name).toBe("replacement");
		registry.dispose();
	});

	it("resetMaterialization() preserves registration and re-materializes a fresh service", async () => {
		const registry = createRegistry();
		const factory = vi
			.fn<() => FakeClient>()
			.mockReturnValueOnce(createClient("first"))
			.mockReturnValueOnce(createClient("second"));

		registry.register({
			key: "lazy",
			priority: ClientInitializationPriority.Lazy,
			clientFactory: factory,
			urlPatterns: ["https://lazy.example.com"],
			requirementKind: "lazy_kind",
		});

		expect(registry.state.get()).toMatchObject({
			registeredKeys: ["lazy"],
			readyKeys: [],
			entries: [
				{
					key: "lazy",
					readiness: "not_initialized",
					generation: 1,
					lifecycleError: null,
				},
			],
		});

		expect(registry.has("lazy")).toBe(true);
		expect(registry.registeredKeys()).toEqual(["lazy"]);
		expect(registry.readyKeys()).toEqual([]);

		const firstService = await registry.whenReady("lazy");
		expect(firstService.client.name).toBe("first");
		expect(registry.readyKeys()).toEqual(["lazy"]);
		expect(registry.state.get().entries[0]).toMatchObject({
			key: "lazy",
			readiness: "ready",
			generation: 1,
			lifecycleError: null,
		});

		expect(registry.resetMaterialization("lazy")).toBe(true);
		expect(firstService.disposed).toBe(true);
		expect(registry.has("lazy")).toBe(true);
		expect(registry.registeredKeys()).toEqual(["lazy"]);
		expect(registry.readyKeys()).toEqual([]);
		expect(registry.state.get().entries[0]).toMatchObject({
			key: "lazy",
			readiness: "not_initialized",
			generation: 2,
			lifecycleError: null,
		});
		expect(registry.clientKeyListForUrl("https://lazy.example.com/x")).toEqual([
			"lazy",
		]);

		const secondService = await registry.whenReady("lazy");
		expect(secondService.client.name).toBe("second");
		expect(secondService).not.toBe(firstService);
		expect(factory).toHaveBeenCalledTimes(2);
		expect(registry.resetMaterialization("missing")).toBe(false);
		registry.dispose();
	});

	it("whenReady() without a key materializes the sole registered lazy client", async () => {
		const registry = createRegistry();
		const factory = vi.fn<() => FakeClient>(() => createClient("only"));

		registry.register({
			key: "only",
			priority: ClientInitializationPriority.Lazy,
			clientFactory: factory,
		});

		const service = await registry.whenReady();
		expect(service.client.name).toBe("only");
		expect(factory).toHaveBeenCalledTimes(1);
		expect(registry.readyKeys()).toEqual(["only"]);
		registry.dispose();
	});

	it("whenReady() without a key rejects ambiguous or empty registries", async () => {
		const empty = createRegistry();
		await expect(empty.whenReady()).rejects.toThrow(
			"requires one registered client, but no clients are registered",
		);

		const multi = createRegistry();
		multi.register({
			key: "first",
			priority: ClientInitializationPriority.Lazy,
			clientFactory: () => createClient("first"),
		});
		multi.register({
			key: "second",
			priority: ClientInitializationPriority.Lazy,
			clientFactory: () => createClient("second"),
		});

		await expect(multi.whenReady()).rejects.toThrow(
			"without a key is only valid for a single registered client",
		);
		empty.dispose();
		multi.dispose();
	});

	it("rejects stale async materialization after unregister() and best-effort disposes the stale service", async () => {
		const deferred = createDeferred<FakeClient>();
		let materializeCount = 0;
		let materializedService: FakeService | undefined;
		const registry = createTokenSetAuthRegistry<FakeClient, FakeService>({
			materialize: (client) => {
				materializeCount += 1;
				materializedService = {
					client,
					authEvents: client.authEvents,
					disposed: false,
					disposeCount: 0,
				};
				return materializedService;
			},
			dispose: (service) => {
				service.disposed = true;
				service.disposeCount += 1;
			},
			authEventsOf: (service) => service.authEvents,
			environment: TEST_ENVIRONMENT,
		});

		registry.register({
			key: "async",
			priority: ClientInitializationPriority.Lazy,
			clientFactory: () => deferred.promise,
		});

		const pending = registry.whenReady("async");
		expect(registry.unregister("async")).toBe(true);

		deferred.resolve(createClient("stale"));

		await expect(pending).rejects.toBeInstanceOf(
			TokenSetAuthRegistryLifecycleError,
		);
		await expect(pending).rejects.toMatchObject({
			code: TokenSetAuthRegistryLifecycleErrorCode.ClientUnregistered,
			clientKey: "async",
		});
		expect(materializeCount).toBe(0);
		expect(materializedService).toBeUndefined();
		expect(registry.isReady("async")).toBe(false);
		expect(registry.readyKeys()).toEqual([]);
		registry.dispose();
	});

	it("rejects stale async materialization after resetMaterialization() without materializing the stale generation", async () => {
		const materializedClients: string[] = [];
		const registry = createTokenSetAuthRegistry<FakeClient, FakeService>({
			materialize: (client) => {
				materializedClients.push(client.name);
				return {
					client,
					authEvents: client.authEvents,
					disposed: false,
					disposeCount: 0,
				};
			},
			dispose: (service) => {
				service.disposed = true;
				service.disposeCount += 1;
				service.client.dispose();
			},
			authEventsOf: (service) => service.authEvents,
			environment: TEST_ENVIRONMENT,
		});
		const first = createDeferred<FakeClient>();
		const second = createDeferred<FakeClient>();
		const factory = vi
			.fn<() => Promise<FakeClient>>()
			.mockImplementationOnce(() => first.promise)
			.mockImplementationOnce(() => second.promise);

		registry.register({
			key: "async",
			priority: ClientInitializationPriority.Lazy,
			clientFactory: factory,
		});

		const stale = registry.whenReady("async");
		expect(registry.resetMaterialization("async")).toBe(true);
		const fresh = registry.whenReady("async");

		first.resolve(createClient("stale"));
		second.resolve(createClient("fresh"));

		await expect(stale).rejects.toBeInstanceOf(
			TokenSetAuthRegistryLifecycleError,
		);
		await expect(stale).rejects.toMatchObject({
			code: TokenSetAuthRegistryLifecycleErrorCode.MaterializationReset,
			clientKey: "async",
		});
		await expect(fresh).resolves.toMatchObject({
			client: expect.objectContaining({ name: "fresh" }),
		});
		expect(materializedClients).toEqual(["fresh"]);
		expect(factory).toHaveBeenCalledTimes(2);
		registry.dispose();
	});

	it("checks sync reentrant invalidation before materialize() side effects", () => {
		let registry!: TokenSetAuthRegistry<FakeClient, FakeService>;
		let materializeCount = 0;
		registry = createTokenSetAuthRegistry<FakeClient, FakeService>({
			materialize: (client) => {
				materializeCount += 1;
				return {
					client,
					authEvents: client.authEvents,
					disposed: false,
					disposeCount: 0,
				};
			},
			dispose: (service) => {
				service.disposed = true;
				service.disposeCount += 1;
			},
			authEventsOf: (service) => service.authEvents,
			environment: TEST_ENVIRONMENT,
		});

		let thrown: unknown;
		try {
			registry.register({
				key: "sync",
				clientFactory: () => {
					registry.unregister("sync");
					return createClient("sync");
				},
			});
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(TokenSetAuthRegistryLifecycleError);
		expect(thrown).toMatchObject({
			code: TokenSetAuthRegistryLifecycleErrorCode.ClientUnregistered,
			clientKey: "sync",
		});
		expect(materializeCount).toBe(0);
		expect(registry.has("sync")).toBe(false);
		registry.dispose();
	});

	it("does not auto-retry failed materialization until resetMaterialization()", async () => {
		const registry = createRegistry();
		let attempts = 0;
		registry.register({
			key: "flaky",
			priority: ClientInitializationPriority.Lazy,
			clientFactory: async () => {
				attempts += 1;
				if (attempts === 1) {
					throw new Error("boom");
				}
				return createClient("recovered");
			},
		});

		await expect(registry.whenReady("flaky")).rejects.toThrow(/boom/);
		expect(registry.readinessState("flaky")).toBe("failed");
		expect(registry.state.get().entries[0]).toMatchObject({
			key: "flaky",
			readiness: "failed",
			lifecycleError: expect.any(Error),
		});
		await expect(registry.whenReady("flaky")).rejects.toThrow(/boom/);
		expect(attempts).toBe(1);

		expect(registry.resetMaterialization("flaky")).toBe(true);
		await expect(registry.whenReady("flaky")).resolves.toMatchObject({
			client: expect.objectContaining({ name: "recovered" }),
		});
		expect(attempts).toBe(2);
		registry.dispose();
	});

	it("exposes registered snapshots independently from ready keys", async () => {
		const registry = createRegistry();
		registry.register({
			key: "lazy",
			priority: ClientInitializationPriority.Lazy,
			clientFactory: () => createClient("lazy"),
			urlPatterns: ["https://lazy.example.com"],
			requirementKind: "lazy_kind",
			providerFamily: "docs",
		});
		registry.register({
			key: "ready",
			clientFactory: () => createClient("ready"),
			providerFamily: "docs",
		});

		expect(registry.registeredKeys()).toEqual(["lazy", "ready"]);
		expect(registry.readyKeys()).toEqual(["ready"]);

		const registeredEntries = registry.registeredEntriesSnapshot();
		const registeredMeta = registry.registeredMetaSnapshot();
		registeredEntries[0][1].callbackPath = "/mutated";
		registeredMeta[0] = {
			...registeredMeta[0]!,
			providerFamily: "mutated",
		};

		expect(
			registry.registeredEntriesSnapshot()[0]?.[1].callbackPath,
		).toBeUndefined();
		expect(registry.metaFor("lazy")?.providerFamily).toBe("docs");
		expect(registry.readyKeys()).toHaveLength(1);
		expect(registry.registeredKeys()).toEqual(
			registry.state.get().registeredKeys,
		);
		expect(registry.readyKeys()).toEqual(registry.state.get().readyKeys);
		registry.dispose();
	});

	it("tracks async initialization in state and keeps stale failures from polluting fresh generations", async () => {
		const registry = createRegistry();
		const first = createDeferred<FakeClient>();
		const second = createDeferred<FakeClient>();
		const factory = vi
			.fn<() => Promise<FakeClient>>()
			.mockImplementationOnce(() => first.promise)
			.mockImplementationOnce(() => second.promise);

		registry.register({
			key: "async",
			priority: ClientInitializationPriority.Lazy,
			clientFactory: factory,
		});

		const stale = registry.whenReady("async");
		expect(registry.state.get().entries[0]).toMatchObject({
			key: "async",
			readiness: "initializing",
			generation: 1,
		});

		expect(registry.resetMaterialization("async")).toBe(true);
		expect(registry.state.get().entries[0]).toMatchObject({
			key: "async",
			readiness: "not_initialized",
			generation: 2,
			lifecycleError: null,
		});

		const fresh = registry.whenReady("async");
		expect(registry.state.get().entries[0]).toMatchObject({
			key: "async",
			readiness: "initializing",
			generation: 2,
		});

		first.reject(new Error("stale failure"));
		second.resolve(createClient("fresh"));

		await expect(stale).rejects.toBeInstanceOf(
			TokenSetAuthRegistryLifecycleError,
		);
		await expect(fresh).resolves.toMatchObject({
			client: expect.objectContaining({ name: "fresh" }),
		});
		expect(registry.state.get().entries[0]).toMatchObject({
			key: "async",
			readiness: "ready",
			generation: 2,
			lifecycleError: null,
		});
		registry.dispose();
	});
});
