import { describe, expect, it, vi } from "vitest";
import { createClientEnvironment } from "../create";

describe("createClientEnvironment()", () => {
	it("fills non-host defaults while requiring explicit transport", async () => {
		const transport = {
			execute: vi.fn(async () => ({ status: 204, headers: {} })),
		};

		const environment = createClientEnvironment({
			transport,
		});

		expect(environment.transport).toBe(transport);
		expect(environment.time.now()).toBeTypeOf("number");
		expect(typeof environment.time.setTimeout).toBe("function");
		expect(typeof environment.time.clearTimeout).toBe("function");
	});
});
