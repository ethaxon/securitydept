import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it } from "vitest";
import {
	createSchema,
	validateWithSchema,
	validateWithSchemaSync,
} from "../../validation/index";

describe("foundation validation baseline", () => {
	// A minimal schema for testing — no external library needed.
	const nameSchema = createSchema<{ name: string }>({
		validate(input: unknown) {
			if (
				typeof input === "object" &&
				input !== null &&
				"name" in input &&
				typeof (input as { name: unknown }).name === "string"
			) {
				return { value: { name: (input as { name: string }).name } };
			}
			return {
				issues: [{ message: "Expected object with string 'name'" }],
			};
		},
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
				expect(result.issues[0]?.message).toBe(
					"Expected object with string 'name'",
				);
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

	describe("createSchema", () => {
		it("creates a StandardSchemaV1-compatible schema", () => {
			const schema: StandardSchemaV1<unknown, { name: string }> = nameSchema;

			expect(schema["~standard"].version).toBe(1);
			expect(schema["~standard"].vendor).toBe("securitydept");
			expect(typeof schema["~standard"].validate).toBe("function");
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
	});
});
