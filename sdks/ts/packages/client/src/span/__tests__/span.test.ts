import { describe, expect, it } from "vitest";
import { createSpan } from "../span";
import { createSpanContextHostForTest } from "../test";

describe("span context host", () => {
	it("makes the current span visible inside runWithSpan", async () => {
		const host = createSpanContextHostForTest();
		const root = createSpan({
			idFactory: () => "span_root",
		});

		await host.runWithSpan(root, async () => {
			expect(host.currentSpan()?.id).toBe("span_root");
			await Promise.resolve();
			expect(host.currentSpan()?.id).toBe("span_root");
		});

		expect(host.currentSpan()).toBeUndefined();
	});

	it("keeps nested runWithSpan scopes isolated", async () => {
		const host = createSpanContextHostForTest();
		const root = createSpan({
			idFactory: () => "span_root",
		});
		const child = root.fork({
			idFactory: () => "span_child",
		});

		await host.runWithSpan(root, async () => {
			expect(host.currentSpan()?.id).toBe("span_root");
			await host.runWithSpan(child, async () => {
				expect(host.currentSpan()?.id).toBe("span_child");
				expect(host.currentSpan()?.parentId).toBe("span_root");
			});
			expect(host.currentSpan()?.id).toBe("span_root");
		});

		expect(host.currentSpan()).toBeUndefined();
	});
});
