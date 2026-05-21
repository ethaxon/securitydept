import { describe, expect, it, vi } from "vitest";
import { createClientEnvironment } from "../create";

describe("createClientEnvironment()", () => {
	it("fills non-host defaults while requiring explicit transport", async () => {
		const transport = {
			execute: vi.fn(async () => ({ status: 204, headers: {} })),
		};

		const environment = createClientEnvironment({ transport });

		expect(environment.transport).toBe(transport);
		expect(environment.scheduler).toBeDefined();
		expect(environment.clock.now()).toBeTypeOf("number");
	});
});
