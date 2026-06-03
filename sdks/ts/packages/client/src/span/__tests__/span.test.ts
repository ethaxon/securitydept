import { type as defineType } from "arktype";
import { describe, expect, it } from "vitest";
import { createRootSpan } from "../span";

describe("span", () => {
	it("uses UUID v7 ids by default", () => {
		const root = createRootSpan();
		const child = root.fork();
		const spanIdPattern = /^span_[0-9a-f-]+$/iu;

		expect(root.id).toMatch(spanIdPattern);
		expect(child.id).toMatch(spanIdPattern);
		expect(child.parent).toBe(root);
	});

	it("keeps explicit parent links across forked spans", () => {
		const root = createRootSpan({
			idFactory: () => "span_root",
			attributes: { scope: "root" },
		});
		const child = root.fork({
			idFactory: () => "span_child",
			attributes: { scope: "child" },
		});

		expect(root.parent).toBeUndefined();
		expect(root.attributes).toEqual({ scope: "root" });
		expect(child.parent?.id).toBe("span_root");
		expect(child.attributes).toEqual({ scope: "child" });
	});

	it("preserves the full explicit chain for downstream traversal", () => {
		const root = createRootSpan({
			idFactory: () => "span_root",
			attributes: { level: "root" },
		});
		const registry = root.fork({
			idFactory: () => "span_registry",
			attributes: { level: "registry" },
		});
		const client = registry.fork({
			idFactory: () => "span_client",
			attributes: { level: "client" },
		});
		const operation = client.fork({
			idFactory: () => "span_operation",
			attributes: { level: "operation" },
		});

		expect(operation.parent?.id).toBe("span_client");
		expect(operation.parent?.parent?.id).toBe("span_registry");
		expect(operation.parent?.parent?.parent?.id).toBe("span_root");
	});

	it("uses caller-provided validators for root span constructor options", () => {
		expect(() =>
			createRootSpan({
				validators: defineType({
					attributes: {
						required: "string",
					},
				}),
				attributes: {},
			}),
		).toThrow(/spanCreateOptions/);
	});
});
