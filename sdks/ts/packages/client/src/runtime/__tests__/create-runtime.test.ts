import { describe, expect, it, vi } from "vitest";
import { createRuntime } from "../create-runtime";

describe("createRuntime()", () => {
	it("fills non-host defaults while requiring explicit transport", async () => {
		const transport = {
			execute: vi.fn(async () => ({ status: 204, headers: {} })),
		};

		const runtime = createRuntime({ transport });

		expect(runtime.transport).toBe(transport);
		expect(runtime.scheduler).toBeDefined();
		expect(runtime.clock.now()).toBeTypeOf("number");
	});
});
