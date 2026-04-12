// Multi-client lazy initialization / idle prefetch contract evidence
//
// Iteration 110 evidence: the shared registry core at
// `@securitydept/token-set-context-client/registry` codifies the
// primary-vs-lazy client lifecycle. This test proves the contract at the
// framework-neutral layer so Angular / React / raw-Web hosts share a
// single lifecycle vocabulary.
//
// Covers:
//   - `priority: "primary"` clients materialize eagerly at register() time
//   - `priority: "lazy"` clients stay not_initialized until asked
//   - `preload(key)` / `whenReady(key)` trigger the same transition
//   - `idleWarmup()` enumerates all lazy+uninitialized keys and schedules
//     their preload via a pluggable idle scheduler
//   - failure paths: async factory rejection marks `failed`; `reset(key)`
//     allows re-registration

import {
	ClientInitializationPriority,
	createTokenSetAuthRegistry,
} from "@securitydept/token-set-context-client/registry";
import { describe, expect, it, vi } from "vitest";

interface FakeClient {
	readonly name: string;
}
interface FakeService {
	readonly client: FakeClient;
	disposed: boolean;
	accessToken: string | null;
}

function makeRegistry(idleScheduler?: (cb: () => void) => () => void) {
	return createTokenSetAuthRegistry<FakeClient, FakeService>({
		materialize: (client) => ({
			client,
			disposed: false,
			accessToken: `tok-${client.name}`,
		}),
		dispose: (service) => {
			service.disposed = true;
		},
		accessTokenOf: (service) => service.accessToken,
		idleScheduler,
	});
}

describe("Multi-client lazy init contract (framework-neutral)", () => {
	it("primary clients are ready immediately after register()", () => {
		const registry = makeRegistry();
		const factory = vi.fn().mockReturnValue({ name: "primary" });
		const service = registry.register({
			key: "primary",
			clientFactory: factory,
			priority: ClientInitializationPriority.Primary,
		}) as FakeService;
		expect(factory).toHaveBeenCalledOnce();
		expect(registry.readinessState("primary")).toBe("ready");
		expect(service.client.name).toBe("primary");
		registry.dispose();
	});

	it("lazy clients stay not_initialized until whenReady / preload", async () => {
		const registry = makeRegistry();
		const factory = vi.fn().mockReturnValue({ name: "lazy" });
		const registered = registry.register({
			key: "lazy",
			clientFactory: factory,
			priority: ClientInitializationPriority.Lazy,
		});
		expect(registered).toBeUndefined();
		expect(factory).not.toHaveBeenCalled();
		expect(registry.readinessState("lazy")).toBe("not_initialized");
		expect(registry.get("lazy")).toBeUndefined();

		const service = await registry.whenReady("lazy");
		expect(factory).toHaveBeenCalledOnce();
		expect(service.client.name).toBe("lazy");
		expect(registry.readinessState("lazy")).toBe("ready");
		registry.dispose();
	});

	it("preload triggers materialization without throwing synchronously", async () => {
		const registry = makeRegistry();
		const factory = vi.fn().mockImplementation(async () => ({ name: "lazy" }));
		registry.register({
			key: "lazy",
			clientFactory: factory,
			priority: ClientInitializationPriority.Lazy,
		});
		const promise = registry.preload("lazy");
		expect(registry.readinessState("lazy")).toBe("initializing");
		const service = await promise;
		expect(service.client.name).toBe("lazy");
		expect(registry.readinessState("lazy")).toBe("ready");
		registry.dispose();
	});

	it("idleWarmup schedules preload for every lazy+not_initialized key", async () => {
		const scheduledCallbacks: Array<() => void> = [];
		const idleScheduler = (cb: () => void) => {
			scheduledCallbacks.push(cb);
			return () => {};
		};
		const registry = makeRegistry(idleScheduler);
		registry.register({
			key: "p",
			clientFactory: () => ({ name: "p" }),
			priority: ClientInitializationPriority.Primary,
		});
		registry.register({
			key: "l1",
			clientFactory: () => ({ name: "l1" }),
			priority: ClientInitializationPriority.Lazy,
		});
		registry.register({
			key: "l2",
			clientFactory: () => ({ name: "l2" }),
			priority: ClientInitializationPriority.Lazy,
		});

		const cancelAll = registry.idleWarmup();
		expect(scheduledCallbacks).toHaveLength(2); // only lazy ones

		// Fire the scheduled callbacks → they preload each lazy key.
		for (const cb of scheduledCallbacks) cb();
		await Promise.resolve();

		expect(registry.readinessState("l1")).toBe("ready");
		expect(registry.readinessState("l2")).toBe("ready");
		cancelAll();
		registry.dispose();
	});

	it("idleWarmup is a no-op for already-materialized lazy clients", async () => {
		const scheduledCallbacks: Array<() => void> = [];
		const registry = makeRegistry((cb) => {
			scheduledCallbacks.push(cb);
			return () => {};
		});
		registry.register({
			key: "lazy",
			clientFactory: () => ({ name: "lazy" }),
			priority: ClientInitializationPriority.Lazy,
		});
		await registry.whenReady("lazy"); // pre-materialize
		scheduledCallbacks.length = 0;
		registry.idleWarmup();
		expect(scheduledCallbacks).toHaveLength(0);
		registry.dispose();
	});

	it("async factory rejection is observable via readinessState=failed and recoverable via reset()", async () => {
		const registry = makeRegistry();
		let failFirst = true;
		registry.register({
			key: "flaky",
			clientFactory: async () => {
				if (failFirst) {
					failFirst = false;
					throw new Error("boom");
				}
				return { name: "flaky" };
			},
			priority: ClientInitializationPriority.Primary,
		});
		await expect(registry.whenReady("flaky")).rejects.toThrow(/boom/);
		expect(registry.readinessState("flaky")).toBe("failed");

		registry.reset("flaky");
		expect(registry.readinessState("flaky")).toBe("not_initialized");

		registry.register({
			key: "flaky",
			clientFactory: async () => ({ name: "flaky" }),
			priority: ClientInitializationPriority.Primary,
		});
		const svc = await registry.whenReady("flaky");
		expect(svc.client.name).toBe("flaky");
		registry.dispose();
	});

	it("dispose() tears down every materialized service and clears all state", async () => {
		const registry = makeRegistry();
		const svcA = registry.register({
			key: "a",
			clientFactory: () => ({ name: "a" }),
		}) as FakeService;
		registry.register({
			key: "b",
			clientFactory: () => ({ name: "b" }),
			priority: ClientInitializationPriority.Lazy,
		});
		await registry.whenReady("b");
		const svcB = registry.get("b") as FakeService;
		registry.dispose();
		expect(svcA.disposed).toBe(true);
		expect(svcB.disposed).toBe(true);
		expect(registry.keys()).toEqual([]);
	});
});
