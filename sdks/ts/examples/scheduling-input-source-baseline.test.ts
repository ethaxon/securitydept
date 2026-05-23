// @vitest-environment jsdom
// TimeTrait & input-source baseline — contract evidence.

import {
	createDefaultTimeConfig,
	createSignal,
	fromAbortSignal,
	fromEventPattern,
	fromInterval,
	fromPromise,
	fromScheduleAt,
	fromSignal,
	fromTimeout,
	type PromiseSettlement,
	PromiseSettlementKind,
} from "@securitydept/client";
import { fromStorageEvent } from "@securitydept/client/web";
import { FrontendOidcModeClient } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import { describe, expect, it, vi } from "vitest";

function createTestTime() {
	const scheduled: Array<{
		delayMs: number;
		fn: () => void;
		canceled: boolean;
	}> = [];
	return {
		scheduled,
		now: () => Date.now(),
		setTimeout(fn: () => void, delayMs: number) {
			const task = { delayMs, fn, canceled: false };
			scheduled.push(task);
			return task;
		},
		clearTimeout(handle: unknown) {
			if (
				typeof handle === "object" &&
				handle !== null &&
				"canceled" in handle
			) {
				(handle as { canceled: boolean }).canceled = true;
			}
		},
	};
}

describe("time event sources — export shape and behavior", () => {
	it("fromTimeout subscribes lazily and can be unsubscribed", () => {
		const time = createTestTime();
		const next = vi.fn();

		const subscription = fromTimeout({ time, delayMs: 1 }).subscribe({ next });
		expect(time.scheduled).toHaveLength(1);
		subscription.unsubscribe();
		time.scheduled[0].fn();

		expect(next).not.toHaveBeenCalled();
	});

	it("fromInterval reschedules after each tick", () => {
		const time = createTestTime();
		const next = vi.fn();

		const subscription = fromInterval({ time, periodMs: 100 }).subscribe({
			next,
		});

		time.scheduled[0].fn();
		expect(next).toHaveBeenCalledOnce();
		expect(time.scheduled).toHaveLength(2);
		expect(time.scheduled[1].delayMs).toBe(100);

		subscription.unsubscribe();
	});

	it("fromScheduleAt uses TimeTrait.now() to compute delay", () => {
		const time = {
			...createTestTime(),
			now: () => 1000,
		};
		const next = vi.fn();

		fromScheduleAt({ time, atMs: 1500 }).subscribe({ next });

		expect(time.scheduled[0].delayMs).toBe(500);
	});

	it("fromEventPattern, fromSignal, and fromPromise are EventStream sources", async () => {
		const handlers: Array<(value: string) => void> = [];
		const eventNext = vi.fn();
		const signalNext = vi.fn();
		const settlements: PromiseSettlement<string>[] = [];
		const signal = createSignal("idle");

		const eventSubscription = fromEventPattern<string>({
			addHandler: (handler) => handlers.push(handler),
			removeHandler: (handler) => {
				const index = handlers.indexOf(handler);
				if (index >= 0) handlers.splice(index, 1);
			},
		}).subscribe({ next: eventNext });
		const signalSubscription = fromSignal({
			signal,
			emitInitialValue: true,
		}).subscribe({ next: signalNext });
		fromPromise({ promise: Promise.resolve("resolved-config") }).subscribe({
			next: (settlement) => settlements.push(settlement),
		});

		handlers[0]("test-event");
		signal.set("ready");
		await Promise.resolve();

		expect(eventNext).toHaveBeenCalledWith("test-event");
		expect(signalNext).toHaveBeenNthCalledWith(1, "idle");
		expect(signalNext).toHaveBeenNthCalledWith(2, "ready");
		expect(settlements).toEqual([
			{
				kind: PromiseSettlementKind.Fulfilled,
				value: "resolved-config",
			},
		]);

		eventSubscription.unsubscribe();
		signalSubscription.unsubscribe();
	});

	it("createDefaultTimeConfig exposes host time capability", () => {
		const time = createDefaultTimeConfig();

		expect(time.now()).toBeTypeOf("number");
		expect(typeof time.setTimeout).toBe("function");
		expect(typeof time.clearTimeout).toBe("function");
	});
});

describe("browser input adapters", () => {
	it("fromAbortSignal and fromStorageEvent expose browser events as streams", () => {
		const abortController = new AbortController();
		const abortNext = vi.fn();
		const storageNext = vi.fn();
		let storageHandler: ((event: StorageEvent) => void) | undefined;
		const target = {
			addEventListener: (_type: string, listener: EventListener) => {
				storageHandler = listener as (event: StorageEvent) => void;
			},
			removeEventListener: vi.fn(),
		};

		const abortSubscription = fromAbortSignal({
			signal: abortController.signal,
		}).subscribe({ next: abortNext });
		const storageSubscription = fromStorageEvent({
			storageEventTarget: target,
		}).subscribe({ next: storageNext });

		abortController.abort("refresh-cancelled");
		storageHandler?.(
			new StorageEvent("storage", {
				key: "securitydept.webui.auth_context_mode",
				newValue: "token-set-frontend-mode",
			}),
		);

		expect(abortNext).toHaveBeenCalledWith("refresh-cancelled");
		expect(storageNext).toHaveBeenCalledOnce();

		abortSubscription.unsubscribe();
		storageSubscription.unsubscribe();
	});
});

describe("real adoption — FrontendOidcModeClient metadata refresh uses fromInterval()", () => {
	it("recurring interval: second tick is re-scheduled after first tick fires", async () => {
		const time = createTestTime();
		const noopTransport = {
			send: vi.fn().mockResolvedValue({ status: 200, body: null }),
		};

		const client = new FrontendOidcModeClient(
			{
				issuer: "https://idp.example.com",
				clientId: "test-client",
				redirectUri: "https://app.example.com/callback",
				metadataRefreshInterval: "10s",
			},
			{
				transport: noopTransport as never,
				time,
			},
		);

		vi.spyOn(client, "discover").mockImplementation(async () => {
			(
				client as unknown as { _scheduleMetadataRefresh: () => void }
			)._scheduleMetadataRefresh.call(client);
		});

		await client.discover();

		expect(time.scheduled).toHaveLength(1);
		expect(time.scheduled[0].delayMs).toBe(10000);

		time.scheduled[0].fn();

		expect(time.scheduled).toHaveLength(2);
		expect(time.scheduled[1].delayMs).toBe(10000);

		client.dispose();
	});

	it("no interval is installed when metadataRefreshInterval is absent", async () => {
		const time = createTestTime();
		const noopTransport = {
			send: vi.fn().mockResolvedValue({ status: 200, body: null }),
		};

		const client = new FrontendOidcModeClient(
			{
				issuer: "https://idp.example.com",
				clientId: "test-client",
				redirectUri: "https://app.example.com/callback",
			},
			{
				transport: noopTransport as never,
				time,
			},
		);

		vi.spyOn(client, "discover").mockImplementation(async () => {
			(
				client as unknown as { _scheduleMetadataRefresh: () => void }
			)._scheduleMetadataRefresh.call(client);
		});
		await client.discover();

		expect(time.scheduled).toHaveLength(0);

		client.dispose();
	});
});
