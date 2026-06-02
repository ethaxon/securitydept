import { type StandardSchemaV1 } from "@standard-schema/spec";
import { type as defineType } from "arktype";
import { describe, expect, it } from "vitest";
import {
	BaseURIStringSchema,
	UriReferenceStringSchema,
	UriRelativeStringSchema,
	UriStringSchema,
	validateTraitInput,
	validateWithSchema,
	validateWithSchemaSync,
} from "../../validation/index";

describe("foundation validation baseline", () => {
	const nameSchema = defineType({
		name: "string",
	});

	describe("validateWithSchema (async)", () => {
		it("returns success with typed value for valid input", async () => {
			const result = await validateWithSchema(nameSchema, {
				name: "Alice",
			});

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.value).toEqual({ name: "Alice" });
			}
		});

		it("returns failure with issues for invalid input", async () => {
			const result = await validateWithSchema(nameSchema, {
				unexpected: true,
			});

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.issues).toHaveLength(1);
				expect(result.issues[0]?.message).toContain("name");
			}
		});

		it("returns failure for null input", async () => {
			const result = await validateWithSchema(nameSchema, null);

			expect(result.success).toBe(false);
		});
	});

	describe("validateWithSchemaSync", () => {
		it("returns success synchronously", () => {
			const result = validateWithSchemaSync(nameSchema, {
				name: "Bob",
			});

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.value.name).toBe("Bob");
			}
		});

		it("returns failure synchronously", () => {
			const result = validateWithSchemaSync(nameSchema, 42);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.issues.length).toBeGreaterThan(0);
			}
		});
	});

	describe("interoperability", () => {
		it("accepts any StandardSchemaV1-compatible schema", async () => {
			// Simulate a schema from an external library (e.g. zod).
			const externalSchema: StandardSchemaV1<unknown, string> = {
				"~standard": {
					version: 1,
					vendor: "test-vendor",
					validate(input: unknown) {
						if (typeof input === "string") {
							return { value: input };
						}
						return {
							issues: [{ message: "Expected a string" }],
						};
					},
				},
			};

			const success = await validateWithSchema(externalSchema, "hello");
			expect(success.success).toBe(true);
			if (success.success) {
				expect(success.value).toBe("hello");
			}

			const failure = await validateWithSchema(externalSchema, 123);
			expect(failure.success).toBe(false);
		});

		it("normalizes arktype failures into StandardSchema issues", async () => {
			const schema = defineType("string");
			const result = await validateWithSchema(schema, 123);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.issues.length).toBeGreaterThan(0);
				expect(typeof result.issues[0]?.message).toBe("string");
			}
		});
	});

	describe("trait input validation", () => {
		it("accepts schema-validated inputs", () => {
			expect(() =>
				validateTraitInput({
					value: { ok: true },
					bundledSchema: defineType({
						ok: "true",
					}),
					onInvalid() {
						throw new Error("invalid");
					},
				}),
			).not.toThrow();
		});

		it("uses onInvalid for rejected schema inputs", () => {
			expect(() =>
				validateTraitInput({
					value: { ok: false },
					bundledSchema: defineType({
						ok: "true",
					}),
					onInvalid(failure) {
						expect(failure.issues.length).toBeGreaterThan(0);
						throw new Error("invalid");
					},
				}),
			).toThrow("invalid");
		});

		it("skips optional validation when value is undefined", () => {
			expect(() =>
				validateTraitInput({
					value: undefined,
					bundledSchema: defineType({
						ok: "true",
					}),
					optional: true,
					onInvalid() {
						throw new Error("invalid");
					},
				}),
			).not.toThrow();
		});
	});

	describe("URI schemas", () => {
		it("validates absolute, relative, and reference URI strings", () => {
			expect(
				validateWithSchemaSync(UriStringSchema, "https://example.com/path")
					.success,
			).toBe(true);
			expect(validateWithSchemaSync(UriStringSchema, "/relative").success).toBe(
				false,
			);
			expect(
				validateWithSchemaSync(BaseURIStringSchema, "https://example.com/")
					.success,
			).toBe(true);
			expect(
				validateWithSchemaSync(UriRelativeStringSchema, "/relative").success,
			).toBe(true);
			expect(
				validateWithSchemaSync(
					UriRelativeStringSchema,
					"https://example.com/path",
				).success,
			).toBe(false);
			expect(
				validateWithSchemaSync(UriReferenceStringSchema, "/relative").success,
			).toBe(true);
			expect(
				validateWithSchemaSync(
					UriReferenceStringSchema,
					"https://example.com/path",
				).success,
			).toBe(true);
		});
	});
});
