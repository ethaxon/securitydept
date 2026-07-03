import { type as defineType } from "arktype";
import { describe, expect, it } from "vitest";
import { createRootSpan } from "../span";

const TEST_PROVIDER_ID = "test.span.provider";

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
		expect(root.getAttributes()).toEqual({ scope: "root" });
		expect(child.parent?.id).toBe("span_root");
		expect(child.getAttributes()).toEqual({ scope: "child" });
	});

	it("keeps shared and provider attributes separate on each span", () => {
		const span = createRootSpan({ attributes: { scope: "root" } }).fork({
			mutable: true,
			attributes: { scope: "shared", client: "test" },
		});

		span.setAttributes(
			{ scope: "provider", detail: "trace-only" },
			{ providerId: TEST_PROVIDER_ID },
		);

		expect(span.getAttributes()).toEqual({
			scope: "shared",
			client: "test",
		});
		expect(span.getAttributes({ providerId: TEST_PROVIDER_ID })).toEqual({
			scope: "provider",
			client: "test",
			detail: "trace-only",
		});
		expect(
			span.getAttributes({
				providerId: TEST_PROVIDER_ID,
				withShared: false,
			}),
		).toEqual({ scope: "provider", detail: "trace-only" });
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
		expect(operation.getRootToNodePath().map((span) => span.id)).toEqual([
			"span_root",
			"span_registry",
			"span_client",
			"span_operation",
		]);
		expect(
			operation.getRootToNodePath({ skipSelf: true }).map((span) => span.id),
		).toEqual(["span_root", "span_registry", "span_client"]);
	});

	it("preserves repeated provider attributes as root-to-node frames", () => {
		const root = createRootSpan({
			idFactory: () => "span_root",
			attributes: { client: "root-client" },
		});
		const empty = root.fork({ idFactory: () => "span_empty" });
		const parent = empty.fork({
			mutable: true,
			idFactory: () => "span_parent",
		});
		parent.setAttributes(
			{ filename: "parent.ts", line: 10 },
			{ providerId: TEST_PROVIDER_ID },
		);
		const child = parent.fork({
			mutable: true,
			idFactory: () => "span_child",
		});
		child.setAttributes(
			{ filename: "child.ts", line: 20 },
			{ providerId: TEST_PROVIDER_ID },
		);

		expect(
			child.getRootToNodeAttributes({ providerId: TEST_PROVIDER_ID }),
		).toEqual([
			{
				spanId: "span_root",
				attributes: { client: "root-client" },
			},
			{
				spanId: "span_parent",
				parentSpanId: "span_empty",
				attributes: { filename: "parent.ts", line: 10 },
			},
			{
				spanId: "span_child",
				parentSpanId: "span_parent",
				attributes: { filename: "child.ts", line: 20 },
			},
		]);
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
