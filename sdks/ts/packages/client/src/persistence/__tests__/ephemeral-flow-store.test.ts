import { describe, expect, it, vi } from "vitest";
import {
	createEphemeralFlowStore,
	createKeyedEphemeralFlowStore,
} from "../ephemeral-flow-store";
import { createInMemoryRecordStore } from "../memory-store";
import type { RecordStore } from "../types";

describe("createEphemeralFlowStore()", () => {
	it("loads, consumes, and clears one-time flow state", async () => {
		const store = createInMemoryRecordStore();
		const flow = createEphemeralFlowStore<string>({
			store,
			key: "pending",
		});

		await flow.save("fragment-123");
		await expect(flow.load()).resolves.toBe("fragment-123");
		await expect(flow.consume()).resolves.toBe("fragment-123");
		await expect(flow.load()).resolves.toBeNull();

		await flow.save("fragment-456");
		await flow.clear();
		await expect(flow.load()).resolves.toBeNull();
	});

	it("isolates keyed one-time state by flow identity", async () => {
		const store = createInMemoryRecordStore();
		const keyedFlow = createKeyedEphemeralFlowStore<string>({
			store,
			keyPrefix: "pending",
		});

		await keyedFlow.save("state-a", "fragment-a");
		await keyedFlow.save("state-b", "fragment-b");

		await expect(keyedFlow.load("state-a")).resolves.toBe("fragment-a");
		await expect(keyedFlow.load("state-b")).resolves.toBe("fragment-b");
		await expect(keyedFlow.take("state-a")).resolves.toBe("fragment-a");
		await expect(keyedFlow.load("state-a")).resolves.toBeNull();
		await expect(keyedFlow.load("state-b")).resolves.toBe("fragment-b");

		await keyedFlow.clear("state-b");
		await expect(keyedFlow.load("state-b")).resolves.toBeNull();
	});

	it("uses record-store take for unkeyed consume", async () => {
		const store: RecordStore = {
			get: vi.fn(async () => null),
			set: vi.fn(async () => {}),
			take: vi.fn(async () => JSON.stringify("fragment-atomic")),
			remove: vi.fn(async () => {}),
		};
		const flow = createEphemeralFlowStore<string>({
			store,
			key: "pending",
		});

		await expect(flow.consume()).resolves.toBe("fragment-atomic");
		expect(store.take).toHaveBeenCalledWith("pending");
		expect(store.get).not.toHaveBeenCalled();
		expect(store.remove).not.toHaveBeenCalled();
	});

	it("uses record-store take for keyed consume", async () => {
		const store: RecordStore = {
			get: vi.fn(async () => null),
			set: vi.fn(async () => {}),
			take: vi.fn(async () => JSON.stringify("fragment-atomic")),
			remove: vi.fn(async () => {}),
		};
		const keyedFlow = createKeyedEphemeralFlowStore<string>({
			store,
			keyPrefix: "pending",
		});

		await expect(keyedFlow.take("state-a")).resolves.toBe("fragment-atomic");
		expect(store.take).toHaveBeenCalledWith("pending:state-a");
		expect(store.get).not.toHaveBeenCalled();
		expect(store.remove).not.toHaveBeenCalled();
	});
});
