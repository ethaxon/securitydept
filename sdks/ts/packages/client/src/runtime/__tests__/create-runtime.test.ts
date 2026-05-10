import { describe, expect, it, vi } from "vitest";
import { createClientEnvironment } from "../create-runtime";

describe("createClientEnvironment()", () => {
	it("fills non-host defaults while requiring explicit transport", async () => {
		const transport = {
			execute: vi.fn(async () => ({ status: 204, headers: {} })),
		};

		const runtime = createClientEnvironment({ transport });

		expect(runtime.transport).toBe(transport);
		expect(runtime.scheduler).toBeDefined();
		expect(runtime.clock.now()).toBeTypeOf("number");
	});
});
