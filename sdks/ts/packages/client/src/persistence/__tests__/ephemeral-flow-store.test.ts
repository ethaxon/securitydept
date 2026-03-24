import { describe, expect, it } from "vitest";
import { createEphemeralFlowStore } from "../ephemeral-flow-store";
import { createInMemoryRecordStore } from "../memory-store";

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
});
